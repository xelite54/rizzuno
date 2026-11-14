import { createHash } from "node:crypto"
import { supportedCountries, supportedSubdivisions } from "./geographicAccess"

export const GEOGRAPHIC_CONFIG_KEYS = ["SUPPORTED_COUNTRIES", "SUPPORTED_US_REGIONS", "SUPPORTED_SUBDIVISIONS_JSON", "AGE_POLICIES_JSON", "LAUNCH_GEO_SOURCE"] as const

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

/** Compare operator-exported policy configuration without logging review
 * references or reading deployment credentials. Equality is not approval. */
export function geographicConfigFingerprint(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a policy configuration object")
  const env: Record<string, string> = {}
  for (const key of GEOGRAPHIC_CONFIG_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value !== "string") throw new Error(`Missing policy configuration: ${key}`)
    env[key] = value
  }
  if (env.LAUNCH_GEO_SOURCE !== "vercel") throw new Error("Expected reviewed Vercel geolocation adapter")
  let entries: unknown
  try { entries = JSON.parse(env.AGE_POLICIES_JSON) } catch { throw new Error("Invalid AGE_POLICIES_JSON") }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Invalid AGE_POLICIES_JSON")
  const subdivisions = Object.fromEntries(Object.entries(supportedSubdivisions(env)).map(([country, regions]) => [country, [...regions].sort()]))
  const value = canonical({ countries: supportedCountries(env).sort(), subdivisions, agePolicies: entries, geoSource: env.LAUNCH_GEO_SOURCE })
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
