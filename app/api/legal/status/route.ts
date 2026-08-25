import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { hasAcceptedCurrent, describeDbError } from "@/lib/db"

/**
 * Whether the signed-in account has accepted the currently-required version
 * of every required document (age 18+, Terms, Privacy). Drives whether
 * AgeGate blocks matchmaking.
 *
 * Every branch below logs the exact signal that decided which HTTP status
 * gets returned — the response body deliberately stays generic (no secrets,
 * no DATABASE_URL value, ever — just a boolean for whether it's configured
 * at all, and a Postgres/Node error *code*, not a raw connection string or
 * stack trace that could leak it), but the server-side log line for a given
 * request should be enough on its own to tell you which of these actually
 * happened without guessing: `auth()` throwing vs. resolving to no session
 * vs. a real session with no `user.id` vs. DATABASE_URL being unset vs.
 * `hasAcceptedCurrent()` itself throwing (and if so, its real error code).
 */
export async function GET() {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL)

  // Not pre-declared with an explicit type: `auth` is an overloaded
  // function (it also has middleware-wrapping call signatures), and
  // `ReturnType<typeof auth>` picks the wrong one — letting `session`'s
  // type come from this actual zero-argument call resolves correctly.
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("legal/status: auth() threw — returning 500", {
      databaseUrlConfigured,
      ...describeDbError(err),
    })
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    console.error("legal/status: no session.user.id — returning 401", {
      hasSession: Boolean(session),
      databaseUrlConfigured,
    })
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (!databaseUrlConfigured) {
    console.error("legal/status: DATABASE_URL is not configured — returning 500", { userId })
    return NextResponse.json({ error: "database_not_configured" }, { status: 500 })
  }

  try {
    const accepted = await hasAcceptedCurrent(userId)
    console.log("legal/status: returning 200", { userId, accepted })
    return NextResponse.json({ accepted })
  } catch (err) {
    // A real failure (e.g. the database being unreachable, or misconfigured
    // for the connection-pooling mode it's actually deployed against) — not
    // treated as "accepted" (never bypasses acceptance), but also not
    // silently treated as "not yet accepted" either: the client (see
    // useLegalAcceptance.ts) surfaces a non-ok response here as a distinct
    // "error" state, carrying this exact error code, instead of quietly
    // re-showing AgeGate as if this were a normal first-time flow.
    const details = describeDbError(err)
    console.error("legal/status: hasAcceptedCurrent() threw — returning 500", {
      userId,
      databaseUrlConfigured,
      ...details,
    })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
