import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { AGE_ELIGIBILITY_COOKIE, AGE_ELIGIBILITY_MAX_AGE_SECONDS, createEligibilityToken, eligibilitySatisfies, readEligibilityToken, signAgeChallenge } from "@/lib/preAuthEligibility"
import { requestAgePolicy } from "@/lib/agePolicy"
import { ageAssuranceConfig, beginAgeAssurance } from "@/lib/ageAssurance"
import { csrfGuard } from "@/lib/requestSecurity"
import { isRateLimited } from "@/lib/apiRateLimit"
import { AGE_CHALLENGE_COOKIE, eligibilityCookieOptions, eligibilityHeaders } from "@/lib/ageEligibilityHttp"
import { regionUnavailableResponse } from "@/lib/geographicResponse"

export async function GET(request: Request) {
  const policy = requestAgePolicy(request)
  if (!policy || policy.mode === "unavailable") return regionUnavailableResponse(request)
  const claim = await readEligibilityToken((await cookies()).get(AGE_ELIGIBILITY_COOKIE)?.value)
  const provider = policy?.mode === "provider" ? ageAssuranceConfig() : null
  return NextResponse.json({ checked: claim !== null, eligible: eligibilitySatisfies(claim, policy), minimumAge: policy?.minimumAge ?? 18,
    unavailable: policy.mode === "provider" && !provider,
    provider: provider ? { name: provider.name, privacyUrl: provider.privacyUrl } : null }, { headers: eligibilityHeaders })
}

export async function POST(request: Request) {
  const policy = requestAgePolicy(request)
  if (!policy || policy.mode === "unavailable") return regionUnavailableResponse(request)
  const rejected = csrfGuard(request)
  if (rejected) return rejected
  let input: unknown
  try { input = await request.json() } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: eligibilityHeaders }) }
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {}
  // Strict boolean. Legacy DOB payloads and client "verified" flags cannot
  // grant access; denial also removes previous browser eligibility.
  if (body.confirmedAdult !== true) {
    const response = NextResponse.json({ eligible: false, error: body.confirmedAdult !== true ? "confirmation_required" : "region_unavailable" }, { status: 403, headers: eligibilityHeaders })
    response.cookies.set(AGE_ELIGIBILITY_COOKIE, "", { ...eligibilityCookieOptions, maxAge: 0 })
    return response
  }
  if (policy.mode === "provider") {
    if (!ageAssuranceConfig()) return NextResponse.json({ eligible: false, error: "age_assurance_unavailable" }, { status: 503, headers: eligibilityHeaders })
    // Shared cap bounds unauthenticated provider spend without retaining IPs.
    if (await isRateLimited("age-assurance:start", 100, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: eligibilityHeaders })
    try {
      const app = new URL(process.env.APP_URL ?? request.url)
      if (process.env.NODE_ENV === "production" && app.protocol !== "https:") throw new Error("invalid_app_url")
      const reference = crypto.randomUUID()
      const session = await beginAgeAssurance(policy, reference, `${app.origin}/?ageAssurance=complete`)
      const challenge = await signAgeChallenge({ reference, transactionId: session.transactionId, policyKey: policy.key, expiresAt: Date.now() + 15 * 60_000 })
      const response = NextResponse.json({ eligible: false, assuranceRequired: true, redirectUrl: session.redirectUrl }, { headers: eligibilityHeaders })
      response.cookies.set(AGE_CHALLENGE_COOKIE, challenge, { ...eligibilityCookieOptions, maxAge: 15 * 60 })
      response.cookies.set(AGE_ELIGIBILITY_COOKIE, "", { ...eligibilityCookieOptions, maxAge: 0 })
      return response
    } catch { return NextResponse.json({ eligible: false, error: "age_assurance_unavailable" }, { status: 503, headers: eligibilityHeaders }) }
  }
  const now = Date.now()
  const token = await createEligibilityToken(true, now, undefined, { method: "self_attestation", policyKey: policy.key, minimumAge: policy.minimumAge, expiresAt: Math.min(now + AGE_ELIGIBILITY_MAX_AGE_SECONDS * 1000, Date.parse(policy.reviewBy)) })
  const response = NextResponse.json({ eligible: true }, { headers: eligibilityHeaders })
  response.cookies.set(AGE_ELIGIBILITY_COOKIE, token, eligibilityCookieOptions)
  response.cookies.set(AGE_CHALLENGE_COOKIE, "", { ...eligibilityCookieOptions, maxAge: 0 })
  return response
}
