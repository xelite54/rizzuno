import { withHttpMetrics } from "@/lib/httpMetrics"
import { log } from "@/lib/observability"
import { auth } from "@/auth"
import { describeDbError, fileTargetedReport, getUserStatus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { sanitizeText } from "@/lib/textFilter"
import { isValidReportCategory } from "@/lib/signaling/protocol"
import { isReportTargetType } from "@/lib/reportTargets"
import { reportErrorResponse } from "@/lib/reportErrors"

/**
 * The unified report endpoint for every target type. The body carries only
 * `{ targetType, targetId, category, details }` — `targetId` is the
 * target's own opaque reference (a public username for `user`). Any
 * owner/sender/reported-account field a client adds is ignored: lib/db.ts's
 * resolveReportTarget() derives the responsible account from the database.
 * CSRF (Origin) is enforced for every mutation by proxy.ts.
 */
async function handlePOST(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (await isRateLimited(`reports:${userId}`, 10, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })

  let body: { targetType?: unknown; targetId?: unknown; category?: unknown; details?: unknown }
  try { body = await request.json() } catch { return Response.json({ error: "invalid_request" }, { status: 400 }) }
  if (!body || !isReportTargetType(body.targetType) || typeof body.targetId !== "string" || !isValidReportCategory(body.category)) {
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) return Response.json({ error: "account_unavailable" }, { status: 403 })
    await fileTargetedReport({ reporterId: userId, targetType: body.targetType, targetId: body.targetId, category: body.category,
      details: sanitizeText(body.details, 500) || undefined })
    // Deliberately nothing else: no report id, target owner or evidence.
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const mapped = reportErrorResponse(error)
    if (mapped) return mapped
    log.error("reports: failed", { ...describeDbError(error) })
    return Response.json({ error: "report_unavailable" }, { status: 500 })
  }
}

export const POST = withHttpMetrics("/app/api/reports", handlePOST)
