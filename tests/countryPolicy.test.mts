import { test } from "node:test"
import assert from "node:assert/strict"
import { countryPolicyForLocation } from "../lib/countryPolicy.ts"
import { agePolicyForLocation, validateAgePolicies } from "../lib/agePolicy.ts"
import { COUNTRIES_ELIGIBLE_FOR_REVIEW, EXCLUDED_COUNTRIES, locationAllowed, supportedUsRegions, validateGeographicAccess } from "../lib/geographicAccess.ts"
import { createEligibilityToken, eligibilitySatisfies, readEligibilityToken } from "../lib/preAuthEligibility.ts"
import { RECOGNIZED_COUNTRIES } from "../lib/country.ts"

// All approval records in this file are synthetic decisions for tests only.
const review = { status: "approved", minimumAge: 18, mode: "self_attestation", reference: "synthetic fixture, not a legal approval", reviewBy: "2099-01-01" }
function config(country: string, entries: Record<string, unknown> = { [country]: review }) {
  return { SUPPORTED_COUNTRIES: country, AGE_POLICIES_JSON: JSON.stringify(entries) }
}

test("all recognized locations partition into exactly eight exclusions and individually reviewable countries", () => {
  assert.equal(EXCLUDED_COUNTRIES.length, 8)
  assert.equal(COUNTRIES_ELIGIBLE_FOR_REVIEW.length, RECOGNIZED_COUNTRIES.length - 8)
  assert.equal(new Set([...EXCLUDED_COUNTRIES, ...COUNTRIES_ELIGIBLE_FOR_REVIEW]).size, RECOGNIZED_COUNTRIES.length)
  assert.deepEqual([...EXCLUDED_COUNTRIES, ...COUNTRIES_ELIGIBLE_FOR_REVIEW].sort(), [...RECOGNIZED_COUNTRIES].sort())
  for (const country of EXCLUDED_COUNTRIES) assert.equal(countryPolicyForLocation(country, null, config(country)).status, "blocked")
  for (const country of COUNTRIES_ELIGIBLE_FOR_REVIEW) {
    const pending = countryPolicyForLocation(country, null, {})
    assert.equal(pending.status, "pending_review", country)
    assert.equal(pending.minimumAge, 18)
    assert.equal(pending.legalReviewReference, null)
    assert.equal(pending.reviewBy, null)
    assert.equal(agePolicyForLocation(country, null, {}), null)
  }
})

test("every review candidate can be configured individually, without activating any other country", () => {
  for (const country of COUNTRIES_ELIGIBLE_FOR_REVIEW) {
    const env = country === "US"
      ? { ...config(country, { "US-NY": review }), SUPPORTED_SUBDIVISIONS_JSON: '{"US":["NY"]}' }
      : config(country)
    const region = country === "US" ? "NY" : null
    const policy = countryPolicyForLocation(country, region, env)
    assert.equal(policy.status, "approved", country)
    assert.equal(policy.minimumAge, 18)
    assert.equal(policy.ageAssuranceMethod, "self_attestation")
    assert.equal(policy.legalReviewReference, review.reference)
    assert.equal(policy.reviewBy, review.reviewBy)
    assert.ok(agePolicyForLocation(country, region, env))
    const other = country === "KR" ? "GB" : "KR"
    assert.notEqual(countryPolicyForLocation(other, null, env).status, "approved")
  }
})

test("activation requires both explicit approval and a current documented review; legacy entries stay pending", () => {
  const legacy = { ...review }
  Reflect.deleteProperty(legacy, "status")
  for (const entry of [legacy, { ...review, status: "pending_review" }, { ...review, status: "APPROVED" },
    { ...review, reference: "" }, { ...review, reviewBy: "2000-01-01" }, { ...review, reviewBy: "2099-02-30" },
    { ...review, minimumAge: 17 }, { ...review, minimumAge: 18.5 }, { ...review, mode: "checkbox" }]) {
    const env = config("KR", { KR: entry })
    assert.notEqual(countryPolicyForLocation("KR", null, env).status, "approved")
    assert.equal(agePolicyForLocation("KR", null, { ...env, SKIP_LAUNCH_READINESS: "true" }), null)
    assert.throws(() => validateAgePolicies(["KR"], [], env))
  }
  assert.equal(countryPolicyForLocation("KR", null, config("KR", { KR: { ...review, status: "blocked" } })).status, "blocked")
  assert.equal(countryPolicyForLocation("KR", null, config("KR", { KR: { ...review, mode: "unavailable" } })).status, "blocked")
  assert.equal(countryPolicyForLocation("KR", null, { ...config("KR"), SUPPORTED_COUNTRIES: "" }).status, "pending_review")
  for (const country of [null, "XX", "us", ""]) assert.equal(countryPolicyForLocation(country, null, config("KR")).status, "blocked")
  assert.equal(agePolicyForLocation("KR", null, { ...config("KR"), AGE_POLICIES_JSON: "[]" }), null)
  assert.equal(agePolicyForLocation("KR", null, { ...config("KR"), AGE_POLICIES_JSON: "malformed" }), null)
})

test("U.S. access requires reviewed states, intersects both state settings, and never falls back nationally", () => {
  const env = { ...config("US", { US: review, "US-NY": review, "US-TX": review }), SUPPORTED_SUBDIVISIONS_JSON: '{"US":["NY","TX"]}', SUPPORTED_US_REGIONS: "NY,CA" }
  assert.deepEqual(supportedUsRegions(env), ["NY"])
  validateGeographicAccess(env)
  validateAgePolicies(["US"], supportedUsRegions(env), env)
  assert.ok(agePolicyForLocation("US", "NY", env))
  for (const region of [null, "TX", "CA", "XX", "ny"]) assert.equal(agePolicyForLocation("US", region, env), null)
  assert.equal(agePolicyForLocation("US", "NY", { ...env, AGE_POLICIES_JSON: JSON.stringify({ US: review }) }), null)
  assert.equal(locationAllowed("US", "NY", config("US")), false)
  assert.throws(() => validateGeographicAccess(config("US")), /state allowlist/)
  assert.throws(() => supportedUsRegions({ ...env, SUPPORTED_SUBDIVISIONS_JSON: '{"US":["XX"]}' }))
  assert.deepEqual(supportedUsRegions({ ...env, SUPPORTED_SUBDIVISIONS_JSON: '{"US":[]}' }), [])
  assert.deepEqual(supportedUsRegions({ SUPPORTED_US_REGIONS: "NY" }), ["NY"])
  assert.deepEqual(supportedUsRegions({ SUPPORTED_SUBDIVISIONS_JSON: '{"US":["NY"]}' }), ["NY"])
})

test("higher minimums and provider assurance are bound to jurisdiction eligibility", async () => {
  const env = { ...config("US", { "US-MS": { ...review, minimumAge: 21, mode: "provider" } }), SUPPORTED_US_REGIONS: "MS" }
  const policy = agePolicyForLocation("US", "MS", env)!
  assert.equal(policy.minimumAge, 21)
  assert.equal(policy.mode, "provider")
  assert.equal(agePolicyForLocation("US", "MS", { ...env, AGE_POLICIES_JSON: JSON.stringify({ "US-MS": review }) }), null)
  assert.throws(() => validateAgePolicies(["US"], ["MS"], env), /provider configuration/)
  const signing = { AUTH_SECRET: "test-only-country-policy-secret-at-least-32-chars" }
  const now = Date.now(), details = { method: "self_attestation" as const, policyKey: policy.key, minimumAge: 21, expiresAt: now + 60000 }
  const claim = await readEligibilityToken(await createEligibilityToken(true, now, signing, details), now, signing)
  assert.equal(eligibilitySatisfies(claim, policy), false, "even a matching checkbox claim cannot replace provider verification")
  const provider = await readEligibilityToken(await createEligibilityToken(true, now, signing, { ...details, method: "provider" }), now, signing)
  assert.equal(eligibilitySatisfies(provider, policy), true)
})
