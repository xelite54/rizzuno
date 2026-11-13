import { normalizeCountry } from "./country"
import { countryExcluded, locationAllowed, supportedSubdivisions } from "./geographicAccess"

export type CountryAvailability = "blocked" | "pending_review" | "approved"
export type AgeAssuranceMethod = "self_attestation" | "provider" | "unavailable"
export type CountryPolicy = {
  countryCode: string | null
  jurisdiction: string | null
  status: CountryAvailability
  minimumAge: number
  ageAssuranceMethod: AgeAssuranceMethod
  subdivisions: string[] | null
  legalReviewReference: string | null
  reviewBy: string | null
}
type Env = Record<string, string | undefined>

/** One decision used by web eligibility and signed realtime admission.
 * SUPPORTED_COUNTRIES activates a country; AGE_POLICIES_JSON must separately
 * carry an explicit approved, current review for the exact jurisdiction.
 * Legacy records without a status remain pending, never implicitly approved.
 */
export function countryPolicyForLocation(country: string | null, subdivision: string | null, env: Env = process.env, now = Date.now()): CountryPolicy {
  const known = country !== null && normalizeCountry(country) === country
  const policy: CountryPolicy = {
    countryCode: known ? country : null,
    jurisdiction: known ? country : null,
    status: known && !countryExcluded(country) ? "pending_review" : "blocked",
    // Existing conservative product floors are retained; they are not a
    // determination that any particular jurisdiction permits this service.
    minimumAge: country === "US" && subdivision === "MS" ? 21 : country === "US" && ["AL", "NE"].includes(subdivision ?? "") ? 19 : 18,
    ageAssuranceMethod: "unavailable",
    subdivisions: null,
    legalReviewReference: null,
    reviewBy: null,
  }
  if (!known || countryExcluded(country)) return policy
  try {
    const regions = supportedSubdivisions(env)[country!]
    policy.subdivisions = regions ?? (country === "US" ? [] : null)
    const scoped = regions !== undefined || country === "US"
    policy.jurisdiction = scoped ? subdivision ? `${country}-${subdivision}` : null : country
    const entries: unknown = JSON.parse(env.AGE_POLICIES_JSON ?? "{}")
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return policy
    // Scoped decisions must never silently fall back to a national policy.
    if (!scoped && Object.keys(entries).some(key => key.startsWith(`${country}-`))) return policy
    if (!policy.jurisdiction) return policy
    const entry: unknown = (entries as Record<string, unknown>)[policy.jurisdiction]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return policy
    const review = entry as Record<string, unknown>
    const validAge = Number.isSafeInteger(review.minimumAge) && Number(review.minimumAge) >= policy.minimumAge && Number(review.minimumAge) <= 120
    if (validAge) policy.minimumAge = Number(review.minimumAge)
    if (review.mode === "self_attestation" || review.mode === "provider" || review.mode === "unavailable") policy.ageAssuranceMethod = review.mode
    if (typeof review.reference === "string" && review.reference.trim()) policy.legalReviewReference = review.reference
    const validDeadline = typeof review.reviewBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(review.reviewBy) &&
      Number.isFinite(Date.parse(review.reviewBy)) && new Date(review.reviewBy).toISOString().slice(0, 10) === review.reviewBy
    if (validDeadline) policy.reviewBy = review.reviewBy as string
    if (review.status === "blocked" || (review.status === "approved" && review.mode === "unavailable")) {
      policy.status = "blocked"
      return policy
    }
    if (review.status === "approved" && validAge && policy.ageAssuranceMethod !== "unavailable" &&
      policy.legalReviewReference && policy.reviewBy && Date.parse(policy.reviewBy) > now && locationAllowed(country, subdivision, env)) {
      policy.status = "approved"
    }
    return policy
  } catch { return policy }
}
