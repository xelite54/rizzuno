import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { AGE_ELIGIBILITY_COOKIE, AGE_ELIGIBILITY_MAX_AGE_SECONDS, createEligibilityToken, evaluateDateOfBirth, readEligibilityToken } from "@/lib/preAuthEligibility"

const headers = { "Cache-Control": "no-store" }

export async function GET() {
  const store = await cookies()
  const claim = await readEligibilityToken(store.get(AGE_ELIGIBILITY_COOKIE)?.value)
  return NextResponse.json({ checked: claim !== null, eligible: claim?.eligible === true }, { headers })
}

export async function POST(request: Request) {
  let input: unknown
  try { input = await request.json() } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400, headers }) }
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const eligible = evaluateDateOfBirth(body.dateOfBirth, body.meetsHigherLocalAge)
  const token = await createEligibilityToken(eligible)
  const response = NextResponse.json({ eligible }, { status: eligible ? 200 : 403, headers })
  response.cookies.set(AGE_ELIGIBILITY_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AGE_ELIGIBILITY_MAX_AGE_SECONDS,
  })
  return response
}
