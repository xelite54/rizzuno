import { test } from "node:test"
import assert from "node:assert/strict"
import { ciLaunchFixture } from "../scripts/ci-launch-fixture.mjs"
import { validateLaunchReadiness, countryAllowed, locationAllowed } from "../lib/launchReadiness.ts"
import { EXCLUDED_COUNTRIES, supportedCountries, validateGeographicAccess } from "../lib/geographicAccess.ts"
import { requestSubdivision } from "../lib/country.ts"
import { agePolicyForLocation } from "../lib/agePolicy.ts"
import { retentionPolicy, RETENTION_CATEGORIES } from "../lib/retention.ts"
import { boundedReportChat } from "../lib/reportEvidence.ts"

const review = { status:"approved",mode:"self_attestation",minimumAge:18,reference:"synthetic test fixture, not a legal determination",reviewBy:"2099-01-01" }
test("launch rejects missing decisions, excluded countries and expired retention approval", () => {
  const env = { ...ciLaunchFixture, NODE_ENV:"production", AGE_POLICIES_JSON:JSON.stringify({JP:review}), LEGAL_REVIEW_APPROVED:"true",SAFETY_WORKFLOW_APPROVED:"true",RETENTION_SCHEDULER_CONFIRMED:"true" }
  validateLaunchReadiness(env)
  for (const key of ["LEGAL_OPERATOR_NAME","LEGAL_OPERATOR_ADDRESS","PRIVACY_CONTACT_EMAIL","LEGAL_NOTICE_EMAIL","LEGAL_DEPLOYMENT_DISCLOSURE","LAUNCH_REVIEW_REFERENCE","ADMIN_EMAILS","SAFETY_REVIEWER_EMAILS","LEGAL_REVIEW_APPROVED","SAFETY_WORKFLOW_APPROVED","RETENTION_SCHEDULER_CONFIRMED","SUPPORTED_COUNTRIES","LAUNCH_GEO_SOURCE","RECENT_MATCH_REPORT_WINDOW_HOURS","RETENTION_POLICY_JSON","AGE_POLICIES_JSON"]) {
    const candidate: Record<string,string|undefined> = { ...env }; delete candidate[key]
    assert.throws(() => validateLaunchReadiness(candidate), key)
  }
  for (const category of RETENTION_CATEGORIES) {
    const policy = JSON.parse(env.RETENTION_POLICY_JSON); delete policy.categories[category]
    assert.throws(() => retentionPolicy({ RETENTION_POLICY_JSON: JSON.stringify(policy) }), category)
  }
  const expired = JSON.parse(env.RETENTION_POLICY_JSON); expired.reviewBy = "2000-01-01"
  assert.throws(() => retentionPolicy({RETENTION_POLICY_JSON:JSON.stringify(expired)}), /expired/)
  assert.throws(() => validateLaunchReadiness({...env,LEGAL_GOVERNING_LAW:"unreviewed"}), /review/)
  assert.throws(() => validateLaunchReadiness({...env,SUPPORTED_COUNTRIES:"US"}), /state allowlist/)
  assert.throws(() => validateLaunchReadiness({...env,SUPPORTED_US_REGIONS:"NY"}), /allowlisted country/)
  assert.throws(() => validateLaunchReadiness({...env,SUPPORTED_COUNTRIES:"JP,*"}))
})

test("all eight exclusions override allowlists, reviews and every readiness flag", () => {
  const expected = "KP IR CU SY RU BY CN AU".split(" ")
  assert.deepEqual([...EXCLUDED_COUNTRIES].sort(), expected.sort())
  assert.equal(new Set(EXCLUDED_COUNTRIES).size,8)
  for (const country of expected) {
    for (const flag of [undefined,"true","false","TRUE","1"]) {
      const env = {NODE_ENV:"production",SUPPORTED_COUNTRIES:country,SKIP_LAUNCH_READINESS:flag,AGE_POLICIES_JSON:JSON.stringify({[country]:review})}
      assert.equal(countryAllowed(country,env),false,country)
      assert.equal(locationAllowed(country,"NY",env),false,country)
      assert.equal(agePolicyForLocation(country,"NY",env),null,country)
      assert.throws(()=>supportedCountries(env), /excluded/)
    }
  }
})

test("state availability cannot bypass the existing U.S. operator and safety launch approvals", () => {
  // Synthetic startup fixture only; no real state or operator is approved.
  const flags = ["PROVIDER_REGION_DISCLOSURE_REVIEWED", "TRAINED_SAFETY_REVIEWERS_CONFIRMED", "UNDER13_RESPONSE_PROCEDURE_APPROVED", "CYBERTIPLINE_PROCEDURE_APPROVED", "BREACH_RESPONSE_APPROVED", "US_STATE_LAUNCH_REVIEW_APPROVED"]
  const env = { ...ciLaunchFixture, NODE_ENV: "production", SUPPORTED_COUNTRIES: "US", SUPPORTED_US_REGIONS: "NY", AGE_POLICIES_JSON: JSON.stringify({ "US-NY": review }), LEGAL_REVIEW_APPROVED: "true", SAFETY_WORKFLOW_APPROVED: "true", RETENTION_SCHEDULER_CONFIRMED: "true" }
  assert.throws(() => validateLaunchReadiness(env), /US launch operator approval/)
  const fixture = { ...env, ...Object.fromEntries(flags.map(key => [key, "true"])) }
  validateLaunchReadiness(fixture)
  for (const flag of flags) assert.throws(() => validateLaunchReadiness({ ...fixture, [flag]: "false" }), new RegExp(flag))
  assert.throws(() => validateLaunchReadiness({ ...fixture, AGE_POLICIES_JSON: JSON.stringify({ "US-NY": { ...review, status: "pending_review" } }) }), /approved age policy/)
})

test("unknown and unapproved locations deny by default, including development and override", () => {
  for (const mode of ["production","development","test"]) {
    for (const flag of [undefined,"true","false"]) {
      const env = {NODE_ENV:mode,SKIP_LAUNCH_READINESS:flag}
      for (const country of [null,"XX","JP","US"]) {
        assert.equal(countryAllowed(country,env),false)
        assert.equal(locationAllowed(country,null,env),false)
      }
      assert.equal(countryAllowed("JP",{...env,SUPPORTED_COUNTRIES:"JP"}),true)
      assert.equal(agePolicyForLocation("JP",null,{...env,SUPPORTED_COUNTRIES:"JP"}),null)
      assert.equal(countryAllowed("JP",{...env,SUPPORTED_COUNTRIES:"invalid"}),false)
    }
  }
})

test("subdivision restrictions require trusted identified approved regions and separate age reviews", () => {
  const env = {SUPPORTED_COUNTRIES:"JP",SUPPORTED_SUBDIVISIONS_JSON:JSON.stringify({JP:["13"]}),AGE_POLICIES_JSON:JSON.stringify({JP:review,"JP-13":{...review,minimumAge:20}})}
  assert.equal(locationAllowed("JP",null,env),false)
  assert.equal(locationAllowed("JP","27",env),false)
  assert.equal(locationAllowed("JP","13",env),true)
  assert.equal(agePolicyForLocation("JP","13",env)?.minimumAge,20)
  assert.equal(agePolicyForLocation("JP","13",{...env,AGE_POLICIES_JSON:JSON.stringify({JP:review})}),null)
  assert.equal(locationAllowed("JP","13",{...env,SUPPORTED_SUBDIVISIONS_JSON:'{"JP":[]}'}),false)
  assert.equal(locationAllowed("JP","13",{...env,SUPPORTED_SUBDIVISIONS_JSON:'{"JP":["bad-region"]}'}),false)
  assert.throws(()=>validateGeographicAccess({...env,SUPPORTED_SUBDIVISIONS_JSON:'{"US":["NY"]}'}))
  const before = process.env.VERCEL, source = process.env.LAUNCH_GEO_SOURCE
  try {
    const request = new Request("https://example.invalid",{headers:{"x-vercel-ip-country":"JP","x-vercel-ip-country-region":"13"}})
    delete process.env.VERCEL; assert.equal(requestSubdivision(request),null)
    process.env.VERCEL="1"; process.env.LAUNCH_GEO_SOURCE="vercel"; assert.equal(requestSubdivision(request),"13")
  } finally {
    if(before===undefined)delete process.env.VERCEL; else process.env.VERCEL=before
    if(source===undefined)delete process.env.LAUNCH_GEO_SOURCE; else process.env.LAUNCH_GEO_SOURCE=source
  }
})

test("report text snapshot rejects future/old timestamps and caps count and content", () => {
  const now = 1_000_000
  const result = boundedReportChat(Array.from({length:30},(_,i)=>({senderId:"a",text:"x".repeat(800),timestamp:now-i})),now)
  assert.equal(result.length,20); assert.ok(result.every(entry=>entry.text.length===500))
  assert.deepEqual(boundedReportChat([{senderId:"a",text:"old",timestamp:now-120001},{senderId:"b",text:"future",timestamp:now+1}],now),[])
})
