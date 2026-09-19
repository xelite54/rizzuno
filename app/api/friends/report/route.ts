import { withHttpMetrics } from "@/lib/httpMetrics"
import { log } from "../../../../lib/observability"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserIdByUsername, fileReport, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { sanitizeText } from "@/lib/textFilter"
import { isValidReportCategory } from "@/lib/signaling/protocol"

const MAX_DETAILS_LENGTH = 500

/**
 * Reports a search result — addressed by username, same reasoning as
 * app/api/friends/block/route.ts: a search result never carries the
 * target's real account id, so this resolves it server-side only, then
 * reuses the exact same fileReport() the in-call safety-menu report and the
 * "user-report" WS handler (for friends/requesters, which already carry a
 * real userId) both call.
 */
async function handlePOST(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    log.error("friends/report: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (await isRateLimited(`friends-report:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  }

  let body: { username?: unknown; category?: unknown; details?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : ""
  const category = isValidReportCategory(body.category) ? body.category : null
  if (!username || !category) {
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

    await fileReport({
      reporterId: userId,
      reportedId: targetId,
      category,
      details: sanitizeText(body.details, MAX_DETAILS_LENGTH) || undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const details = describeDbError(err)
    log.error("friends/report: failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}

export const POST = withHttpMetrics("/app/api/friends/report", handlePOST)
