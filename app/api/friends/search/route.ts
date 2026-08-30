import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { searchUsersByUsername, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Real account search by username, for the Friends panel's search (see
 * components/match/FriendsPanel.tsx). Was previously backed by an empty
 * local mock array — every search honestly (if uselessly) came back "No one
 * found" regardless of who actually existed. Queries the same `users.username`
 * column every other account-lookup in this app already uses (see
 * lib/db.ts's getUsername/claimUsername) — no new/invented field.
 *
 * Returns only usernames, never account ids — see searchUsersByUsername's
 * own doc comment for why. A result is acted on (add friend / block) by
 * username, via POST /api/friends/request and /api/friends/block, which
 * resolve it back to a real id server-side only.
 */
export async function GET(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("friends/search: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`friends-search:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const url = new URL(request.url)
  const query = (url.searchParams.get("q") ?? "").trim()
  if (!query) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results = await searchUsersByUsername(query, userId)
    return NextResponse.json({ results })
  } catch (err) {
    const details = describeDbError(err)
    console.error("friends/search: query failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
