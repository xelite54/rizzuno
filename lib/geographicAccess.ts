import { RECOGNIZED_COUNTRIES, normalizeCountry, normalizeSubdivision, normalizeUsRegion } from "./country"

type Env = Record<string, string | undefined>

/** Product availability decision. Neither an allowlist entry nor a launch
 * override can enable these countries. This is not a list of legal findings. */
export const EXCLUDED_COUNTRIES = Object.freeze([
  "KP", "IR", "CU", "SY", "RU", "BY", "CN", "AU",
] as const)

const excluded = new Set<string>(EXCLUDED_COUNTRIES)
/** Every other recognized country/territory can undergo individual review.
 * This is an inventory, never an activation allowlist or legal approval. */
export const COUNTRIES_ELIGIBLE_FOR_REVIEW = Object.freeze(RECOGNIZED_COUNTRIES.filter(country => !excluded.has(country)))
export const REGION_UNAVAILABLE_MESSAGE = "Rizzuno is unavailable in your region"

export function countryExcluded(country: string | null) {
  return country !== null && excluded.has(country.toUpperCase())
}

export function supportedCountries(env: Env = process.env): string[] {
  const values = (env.SUPPORTED_COUNTRIES ?? "").split(",").map(value => value.trim()).filter(Boolean)
  if (values.some(value => !normalizeCountry(value) || value !== value.toUpperCase() || countryExcluded(value))) {
    throw new Error("Invalid configuration: SUPPORTED_COUNTRIES contains an invalid or excluded country")
  }
  return [...new Set(values)]
}

/** An entry narrows that country's approval to these subdivisions. An empty
 * entry denies the entire country; missing request subdivision never passes. */
export function supportedSubdivisions(env: Env = process.env): Record<string, string[]> {
  if (!env.SUPPORTED_SUBDIVISIONS_JSON?.trim()) {
    const result: Record<string, string[]> = {}
    mergeUsRegions(result, env)
    return result
  }
  const input: unknown = JSON.parse(env.SUPPORTED_SUBDIVISIONS_JSON)
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid configuration: SUPPORTED_SUBDIVISIONS_JSON")
  const result: Record<string, string[]> = {}
  for (const [country, regions] of Object.entries(input)) {
    if (!normalizeCountry(country) || country !== country.toUpperCase() || countryExcluded(country) || !Array.isArray(regions) ||
      regions.some(region => typeof region !== "string" || normalizeSubdivision(region) !== region ||
        (country === "US" && normalizeUsRegion(region) !== region))) throw new Error("Invalid configuration: SUPPORTED_SUBDIVISIONS_JSON")
    result[country] = [...new Set(regions)]
  }
  mergeUsRegions(result, env)
  return result
}

function mergeUsRegions(result: Record<string, string[]>, env: Env) {
  const raw = env.SUPPORTED_US_REGIONS?.trim()
  if (!raw) return
  const values = raw.split(",").map(value => value.trim())
  if (values.some(value => !normalizeUsRegion(value) || value !== value.toUpperCase())) throw new Error("Invalid configuration: SUPPORTED_US_REGIONS")
  // When both settings are present, each must approve the state. Neither
  // can widen the other's restriction, including an explicit empty list.
  result.US = result.US === undefined ? [...new Set(values)] : result.US.filter(region => values.includes(region))
}

export function supportedUsRegions(env: Env = process.env): string[] {
  return supportedSubdivisions(env).US ?? []
}

export function countryAllowed(country: string | null, env: Env = process.env) {
  if (!country || normalizeCountry(country) !== country || countryExcluded(country)) return false
  try { return supportedCountries(env).includes(country) } catch { return false }
}

export function locationAllowed(country: string | null, subdivision: string | null, env: Env = process.env) {
  if (!countryAllowed(country, env)) return false
  try {
    const regions = supportedSubdivisions(env)[country!]
    if (country === "US" && regions === undefined) return false
    return regions === undefined || (subdivision !== null && normalizeSubdivision(subdivision) === subdivision && regions.includes(subdivision))
  } catch { return false }
}

export function validateGeographicAccess(env: Env = process.env) {
  const countries = supportedCountries(env)
  if (!countries.length) throw new Error("An explicit non-empty SUPPORTED_COUNTRIES allowlist is required for launch")
  for (const country of Object.keys(supportedSubdivisions(env))) {
    if (!countries.includes(country)) throw new Error("SUPPORTED_SUBDIVISIONS_JSON requires an allowlisted country")
  }
  if (countries.includes("US") && !supportedUsRegions(env).length) throw new Error("US requires an explicit non-empty approved state allowlist")
  return countries
}
