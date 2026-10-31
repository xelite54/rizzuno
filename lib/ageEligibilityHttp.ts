import { cookies } from "next/headers"
import { AGE_ELIGIBILITY_COOKIE, AGE_ELIGIBILITY_MAX_AGE_SECONDS, eligibilitySatisfies, readEligibilityToken } from "./preAuthEligibility"
import { requestAgePolicy } from "./agePolicy"

export const eligibilityHeaders = { "Cache-Control": "no-store" }
export const eligibilityCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: AGE_ELIGIBILITY_MAX_AGE_SECONDS }
export const AGE_CHALLENGE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-rizzuno-age-challenge" : "rizzuno-age-challenge"

export async function requestEligibility(request: Request) {
  const claim = await readEligibilityToken((await cookies()).get(AGE_ELIGIBILITY_COOKIE)?.value)
  return eligibilitySatisfies(claim, requestAgePolicy(request)) ? claim : null
}
