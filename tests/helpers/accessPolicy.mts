import { agePolicyForLocation } from "../../lib/agePolicy.ts"
import { mintTicket as mintActualTicket } from "../../lib/realtimeTicket.ts"

// Synthetic fixture only: no finding that Japan permits this service.
// Tests supply reviewed location claims explicitly; production has no bypass.
export const testAgeReview = { status: "approved", mode: "self_attestation", minimumAge: 18, reference: "synthetic test fixture, not a legal determination", reviewBy: "2099-01-01" }
export const testAccessEnv = { SUPPORTED_COUNTRIES: "JP", SUPPORTED_US_REGIONS: "", SUPPORTED_SUBDIVISIONS_JSON: "{}", LAUNCH_GEO_SOURCE: "vercel", AGE_POLICIES_JSON: JSON.stringify({ JP: testAgeReview }) }
export function configureTestAccess() { Object.assign(process.env, testAccessEnv) }
configureTestAccess()

/** Use the real signature and current policy, with no runtime test bypass. */
export function mintTicket(userId: string, countryCode = "JP") {
  const policy = agePolicyForLocation(countryCode, null)
  if (!policy) throw new Error("Missing synthetic access policy")
  return mintActualTicket(userId, countryCode, { ageExpiresAt: Date.now() + 86_400_000, agePolicyKey: policy.key, subdivision: null })
}
