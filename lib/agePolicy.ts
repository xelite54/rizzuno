import { createHash } from "node:crypto"
import { normalizeCountry, normalizeSubdivision } from "./country"
import { supportedSubdivisions } from "./geographicAccess"
import { countryPolicyForLocation, requestCountryPolicy, type CountryPolicy } from "./countryPolicy"
import { ageAssuranceConfig } from "./ageAssurance"

export type AgePolicy = { key: string; jurisdiction: string; minimumAge: number; mode: "self_attestation" | "provider" | "unavailable"; reviewBy: string }
type Env = Record<string, string | undefined>

/** Reviewed deployment policy, not a statutory database. No nationwide default.
 * A missing/expired decision denies access even if a country/state is enabled. */
export function agePolicyForLocation(country: string | null, region: string | null, env: Env = process.env, now = Date.now()): AgePolicy | null {
  return agePolicyForDecision(countryPolicyForLocation(country, region, env, now))
}

function agePolicyForDecision(policy: CountryPolicy): AgePolicy | null {
  if (policy.status !== "approved" || !policy.jurisdiction || !policy.reviewBy) return null
  const key = createHash("sha256").update(JSON.stringify([policy.jurisdiction, policy.minimumAge, policy.ageAssuranceMethod, policy.legalReviewReference, policy.reviewBy, policy.status])).digest("hex")
  return { key, jurisdiction: policy.jurisdiction, minimumAge: policy.minimumAge, mode: policy.ageAssuranceMethod, reviewBy: policy.reviewBy }
}

export function requestAgePolicy(request: Request) {
  return agePolicyForDecision(requestCountryPolicy(request))
}

export function validateAgePolicies(countries: string[], regions: string[], env: Env = process.env) {
  let entries: Record<string, unknown>
  try { entries = JSON.parse(env.AGE_POLICIES_JSON ?? "") } catch { throw new Error("Reviewed AGE_POLICIES_JSON is required") }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Invalid AGE_POLICIES_JSON")
  for (const key of Object.keys(entries)) {
    const [country, region, extra] = key.split("-")
    if (!normalizeCountry(country) || country !== country.toUpperCase() || extra !== undefined || (region !== undefined && normalizeSubdivision(region) !== region)) throw new Error(`Invalid age policy jurisdiction: ${key}`)
    if (region !== undefined && countries.includes(country) && !Object.hasOwn(supportedSubdivisions(env), country)) throw new Error(`Subdivision age policy requires SUPPORTED_SUBDIVISIONS_JSON: ${country}`)
  }
  for (const country of countries) {
    const locations = country === "US" ? regions : supportedSubdivisions(env)[country] ?? [null]
    if (!locations.length) throw new Error(`Missing or expired approved age policy: ${country} has no approved subdivisions`)
    for (const region of locations) {
      const policy = agePolicyForLocation(country, region, env)
      if (!policy) throw new Error(`Missing or expired approved age policy: ${region ? `${country}-${region}` : country}`)
      if (policy.mode === "provider" && !ageAssuranceConfig(env)) throw new Error(`Reviewed age assurance provider configuration required: ${policy.jurisdiction}`)
    }
  }
}
