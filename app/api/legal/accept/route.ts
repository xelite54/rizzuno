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
 * Every step that can genuinely fail (auth.js itself, then the database) is
 * wrapped in its own try/catch rather than left to Next.js's default error
 * handling. Not to hide failures — a real failure still comes back as a
 * non-2xx response and legal acceptance is never faked — but so a genuine
 * failure (e.g. the database being unreachable, or misconfigured for the
 * connection-pooling mode it's actually deployed against) is logged
 * server-side with the real Postgres/Node error code instead of
 * disappearing into a generic error page, and so the client reliably gets
 * back JSON it can check `res.ok` against rather than risking an HTML error
 * page that `fetch` still resolves (not rejects) for.
 */
export async function POST() {
  let userId: string | undefined
  try {
    const session = await auth()
    userId = session?.user?.id
  } catch (err) {
    console.error("legal/accept: auth() itself threw", describeDbError(err))
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`legal-accept:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }

    await recordAcceptance(userId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("legal/accept: failed to record acceptance", { userId, ...describeDbError(err) })
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
