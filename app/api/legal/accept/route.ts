import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { recordAcceptance, getUserStatus, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Records that the signed-in account affirmed they're 18+ and accepted the
 * current Terms and Privacy Policy — all three together, since AgeGate
 * presents them as one combined affirmation. This is a factual record
 * ("this account clicked accept on version X on date Y"), not identity-level
 * age verification — nothing here proves the person's real age.
 *
 * Every branch logs the exact signal that decided the response, same as
 * app/api/legal/status/route.ts — never the DATABASE_URL value itself, just
 * whether it's configured, plus the real Postgres/Node error code when a
 * query fails.
 */
export async function POST() {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL)

  // Not pre-declared with an explicit type: `auth` is an overloaded
  // function (it also has middleware-wrapping call signatures), and
  // `ReturnType<typeof auth>` picks the wrong one — letting `session`'s
  // type come from this actual zero-argument call resolves correctly.
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("legal/accept: auth() threw — returning 500", {
      databaseUrlConfigured,
      ...describeDbError(err),
    })
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    console.error("legal/accept: no session.user.id — returning 401", {
      hasSession: Boolean(session),
      databaseUrlConfigured,
    })
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`legal-accept:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  if (!databaseUrlConfigured) {
    console.error("legal/accept: DATABASE_URL is not configured — returning 500", { userId })
    return NextResponse.json({ error: "database_not_configured" }, { status: 500 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }

    await recordAcceptance(userId)
    console.log("legal/accept: returning 200", { userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const details = describeDbError(err)
    console.error("legal/accept: failed to record acceptance — returning 500", {
      userId,
      databaseUrlConfigured,
      ...details,
    })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
