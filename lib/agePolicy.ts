import { createHash } from "node:crypto"
import { normalizeCountry, normalizeUsRegion, requestCountry, requestUsRegion } from "./country"

export type AgePolicy = { key: string; jurisdiction: string; minimumAge: number; mode: "self_attestation" | "provider" | "unavailable"; reviewBy: string }
type Env = Record<string, string | undefined>

/** Reviewed deployment policy, not a statutory database. No nationwide default.
 * A missing/expired decision denies access even if a country/state is enabled. */
export function agePolicyForLocation(country: string | null, region: string | null, env: Env = process.env, now = Date.now()): AgePolicy | null {
  if (!env.AGE_POLICIES_JSON && env.NODE_ENV !== "production") return { key: "development", jurisdiction: "development", minimumAge: 18, mode: "self_attestation", reviewBy: "2099-01-01" }
  const jurisdiction = country === "US" ? (region ? `US-${region}` : null) : country
  if (!jurisdiction) return null
  try {
    const entries = JSON.parse(env.AGE_POLICIES_JSON ?? "{}")
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
  return agePolicyForLocation(requestCountry(request), requestUsRegion(request))
}

export function validateAgePolicies(countries: string[], regions: string[], env: Env = process.env) {
  let entries: Record<string, unknown>
  try { entries = JSON.parse(env.AGE_POLICIES_JSON ?? "") } catch { throw new Error("Reviewed AGE_POLICIES_JSON is required") }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Invalid AGE_POLICIES_JSON")
  for (const key of Object.keys(entries)) {
    if (!(key.startsWith("US-") ? normalizeUsRegion(key.slice(3)) : key !== "US" && normalizeCountry(key))) throw new Error(`Invalid age policy jurisdiction: ${key}`)
  }
  for (const country of countries) {
    for (const region of country === "US" ? regions : [null]) {
      if (!agePolicyForLocation(country, region, env)) throw new Error(`Missing or expired age policy: ${country === "US" ? `US-${region}` : country}`)
    }
  }
}
