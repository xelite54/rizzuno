import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { requestAgePolicy } from "@/lib/agePolicy"
import { completeAgeAssurance } from "@/lib/ageAssurance"
import { AGE_ELIGIBILITY_COOKIE, createEligibilityToken, readAgeChallenge } from "@/lib/preAuthEligibility"
import { csrfGuard } from "@/lib/requestSecurity"
import { isRateLimited } from "@/lib/apiRateLimit"
import { AGE_CHALLENGE_COOKIE, eligibilityCookieOptions, eligibilityHeaders } from "@/lib/ageEligibilityHttp"
import { regionUnavailableResponse } from "@/lib/geographicResponse"

export async function POST(request: Request) {
  const policy = requestAgePolicy(request)
  if (!policy || policy.mode === "unavailable") return regionUnavailableResponse(request)
  const rejected = csrfGuard(request)
  if (rejected) return rejected
  const challenge = await readAgeChallenge((await cookies()).get(AGE_CHALLENGE_COOKIE)?.value)
  if (!challenge || policy.mode !== "provider" || challenge.policyKey !== policy.key ||
    typeof challenge.reference !== "string" || typeof challenge.transactionId !== "string" ||
    !Number.isSafeInteger(challenge.expiresAt) || Number(challenge.expiresAt) <= Date.now()) {
    return NextResponse.json({ eligible: false, error: "age_assurance_expired" }, { status: 403, headers: eligibilityHeaders })
  }
  if (await isRateLimited(`age-assurance:result:${challenge.reference}`, 10, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: eligibilityHeaders })
  try {
    const result = await completeAgeAssurance(policy, challenge.reference, challenge.transactionId)
    if (result.status === "pending") return NextResponse.json({ eligible: false, error: "age_assurance_pending" }, { status: 409, headers: eligibilityHeaders })
    const response = NextResponse.json({ eligible: result.status === "passed", ...(result.status === "denied" ? { error: "age_assurance_denied" } : {}) }, { status: result.status === "passed" ? 200 : 403, headers: eligibilityHeaders })
    response.cookies.set(AGE_CHALLENGE_COOKIE, "", { ...eligibilityCookieOptions, maxAge: 0 })
    response.cookies.set(AGE_ELIGIBILITY_COOKIE, result.status === "passed" ? await createEligibilityToken(true, Date.now(), undefined, { method: "provider", policyKey: policy.key, minimumAge: policy.minimumAge, expiresAt: result.expiresAt }) : "", { ...eligibilityCookieOptions, maxAge: result.status === "passed" ? Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000)) : 0 })
    return response
  } catch { return NextResponse.json({ eligible: false, error: "age_assurance_unavailable" }, { status: 503, headers: eligibilityHeaders }) }
}
