import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserIdByUsername, addBlock, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Blocks a search result — addressed by username, same reasoning as
 * app/api/friends/request/route.ts: a search result never carries the
 * target's real account id, so this resolves it server-side only, then
 * reuses the exact same addBlock() the in-call safety-menu block already
 * calls (severs any friendship/pending request as part of the same
 * transaction, exactly as it does there).
 */
export async function POST(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("friends/block: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`friends-block:${userId}`, 20, 60_000)) {
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
    const targetId = await getUserIdByUsername(username)
    if (!targetId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    if (targetId === userId) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    }

    await addBlock(userId, targetId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const details = describeDbError(err)
    console.error("friends/block: failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
