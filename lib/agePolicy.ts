import { createHash } from "node:crypto"
import { normalizeCountry, normalizeSubdivision, requestCountry, requestSubdivision } from "./country"
import { locationAllowed, supportedSubdivisions } from "./geographicAccess"

export type AgePolicy = { key: string; jurisdiction: string; minimumAge: number; mode: "self_attestation" | "provider" | "unavailable"; reviewBy: string }
type Env = Record<string, string | undefined>

/** Reviewed deployment policy, not a statutory database. No nationwide default.
 * A missing/expired decision denies access even if a country/state is enabled. */
export function agePolicyForLocation(country: string | null, region: string | null, env: Env = process.env, now = Date.now()): AgePolicy | null {
  if (!locationAllowed(country, region, env)) return null
  try {
    const entries = JSON.parse(env.AGE_POLICIES_JSON ?? "{}")
    const scoped = Object.hasOwn(supportedSubdivisions(env), country!)
    if (!scoped && Object.keys(entries).some(key => key.startsWith(`${country}-`))) return null
    const jurisdiction = region && entries[`${country}-${region}`] ? `${country}-${region}` : scoped ? null : country
    if (!jurisdiction) return null
    const entry = entries[jurisdiction]
    const floor = jurisdiction === "US-MS" ? 21 : ["US-AL", "US-NE"].includes(jurisdiction) ? 19 : 18
    if (!entry || !Number.isSafeInteger(entry.minimumAge) || entry.minimumAge < floor || entry.minimumAge > 120 ||
      !["self_attestation", "provider", "unavailable"].includes(entry.mode) || typeof entry.reference !== "string" || !entry.reference.trim() ||
      typeof entry.reviewBy !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy) || !Number.isFinite(Date.parse(entry.reviewBy)) ||
      new Date(entry.reviewBy).toISOString().slice(0, 10) !== entry.reviewBy || Date.parse(entry.reviewBy) <= now) return null
    const key = createHash("sha256").update(JSON.stringify([jurisdiction, entry.minimumAge, entry.mode, entry.reference, entry.reviewBy])).digest("hex")
    return { key, jurisdiction, minimumAge: entry.minimumAge, mode: entry.mode, reviewBy: entry.reviewBy }
  } catch { return null }
}

export function requestAgePolicy(request: Request) {
  return agePolicyForLocation(requestCountry(request), requestSubdivision(request))
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
    for (const region of country === "US" ? regions : supportedSubdivisions(env)[country] ?? [null]) {
      if (!agePolicyForLocation(country, region, env)) throw new Error(`Missing or expired age policy: ${country === "US" ? `US-${region}` : country}`)
    }
  }
}
