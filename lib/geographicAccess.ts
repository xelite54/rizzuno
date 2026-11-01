import { normalizeCountry, normalizeSubdivision, normalizeUsRegion } from "./country"

type Env = Record<string, string | undefined>

/** Product availability decision. Neither an allowlist entry nor a launch
 * override can enable these countries. This is not a list of legal findings. */
export const EXCLUDED_COUNTRIES = Object.freeze([
  "KP", "IR", "CU", "RU", "BY", "SY", "GB", "AU", "BR", "ID", "MY", "TR", "AE", "US",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
  "CH", "CA", "NZ", "IN", "CN", "KR", "SG", "PH",
] as const)
const excluded = new Set<string>(EXCLUDED_COUNTRIES)
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
  if (!env.SUPPORTED_SUBDIVISIONS_JSON?.trim()) return {}
  const input: unknown = JSON.parse(env.SUPPORTED_SUBDIVISIONS_JSON)
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid configuration: SUPPORTED_SUBDIVISIONS_JSON")
  const result: Record<string, string[]> = {}
  for (const [country, regions] of Object.entries(input)) {
    if (!normalizeCountry(country) || country !== country.toUpperCase() || countryExcluded(country) || !Array.isArray(regions) ||
      regions.some(region => typeof region !== "string" || normalizeSubdivision(region) !== region)) throw new Error("Invalid configuration: SUPPORTED_SUBDIVISIONS_JSON")
    result[country] = [...new Set(regions)]
  }
  return result
}

// Retained for compatibility and future separately reviewed policy changes.
// It cannot override the current nationwide US exclusion.
export function supportedUsRegions(env: Env = process.env): string[] {
  const raw = env.SUPPORTED_US_REGIONS?.trim()
  if (!raw) return []
  const values = raw.split(",").map(value => value.trim())
  if (values.some(value => !normalizeUsRegion(value) || value !== value.toUpperCase())) throw new Error("Invalid configuration: SUPPORTED_US_REGIONS")
  return [...new Set(values)]
}

export function countryAllowed(country: string | null, env: Env = process.env) {
  if (!country || normalizeCountry(country) !== country || countryExcluded(country)) return false
  try { return supportedCountries(env).includes(country) } catch { return false }
}

export function locationAllowed(country: string | null, subdivision: string | null, env: Env = process.env) {
  if (!countryAllowed(country, env)) return false
  try {
    const regions = supportedSubdivisions(env)[country!]
    return regions === undefined || (subdivision !== null && normalizeSubdivision(subdivision) === subdivision && regions.includes(subdivision))
  } catch { return false }
}

export function validateGeographicAccess(env: Env = process.env) {
  const countries = supportedCountries(env)
  if (!countries.length) throw new Error("An explicit non-empty SUPPORTED_COUNTRIES allowlist is required for launch")
  for (const country of Object.keys(supportedSubdivisions(env))) {
    if (!countries.includes(country)) throw new Error("SUPPORTED_SUBDIVISIONS_JSON requires an allowlisted country")
  }
  if (supportedUsRegions(env).length) throw new Error("SUPPORTED_US_REGIONS cannot enable access while US is excluded")
  return countries
}
