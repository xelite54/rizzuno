import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserIdByUsername, getUserStatus, sendFriendRequest, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Sends a friend request to a search result — addressed by username, not
 * account id, since a search result never carries the target's real id to
 * begin with (see lib/db.ts's searchUsersByUsername doc comment). This
 * resolves the username back to a real id here, server-side only, then
 * reuses the exact same sendFriendRequest() the in-call/history friend-
 * request paths already call — same auto-accept-if-mutual, already-
 * friends, and blocked handling, just reached from a username instead of a
 * displayId/known real id.
 */
export async function POST(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("friends/request: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`friends-request:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  let body: { username?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : ""
  if (!username) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }

    const targetId = await getUserIdByUsername(username)
    if (!targetId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const result = await sendFriendRequest(userId, targetId)
    return NextResponse.json({ result: result.status })
  } catch (err) {
    const details = describeDbError(err)
    console.error("friends/request: failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
