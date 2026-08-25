import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { claimUsername, getUserStatus, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

// Same character set and length ChooseUsername.tsx and MyProfileSheet.tsx's
// edit view already filter to client-side — re-validated here because a
// server-side uniqueness guarantee is only as real as the format check
// backing it; a client is never trusted to have actually applied its own
// filtering.
const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/

/**
 * Claims a username for the signed-in account, permanently and uniquely —
 * called both by ChooseUsername (the first pick, required before matching)
 * and by My Profile → Edit profile (changing it later). Same endpoint for
 * both: a uniqueness guarantee enforced only at first pick and not at
 * rename would be trivially pointless.
 *
 * Logged the same way as the other legal/DB-backed routes: every branch
 * states which signal decided the response, DATABASE_URL is only ever
 * logged as a boolean, and a real database error carries its actual
 * Postgres error code.
 */
export async function POST(request: Request) {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL)

  // Not pre-declared with an explicit type: `auth` is an overloaded
  // function (it also has middleware-wrapping call signatures), and
  // `ReturnType<typeof auth>` picks the wrong one — letting `session`'s
  // type come from this actual zero-argument call resolves correctly.
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("profile/username: auth() threw — returning 500", {
      databaseUrlConfigured,
      ...describeDbError(err),
    })
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`username-claim:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  let body: { username?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : ""
  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 })
  }

  if (!databaseUrlConfigured) {
    console.error("profile/username: DATABASE_URL is not configured — returning 500", { userId })
    return NextResponse.json({ error: "database_not_configured" }, { status: 500 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }

    const result = await claimUsername(userId, username)
    if (!result.ok) {
      return NextResponse.json({ error: "username_taken" }, { status: 409 })
    }
    console.log("profile/username: returning 200", { userId })
    return NextResponse.json({ ok: true, username })
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/username: failed to claim username — returning 500", {
      userId,
      databaseUrlConfigured,
      ...details,
    })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
