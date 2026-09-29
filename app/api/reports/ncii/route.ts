import { withHttpMetrics } from "@/lib/httpMetrics"
import { log } from "@/lib/observability"
import { auth } from "@/auth"
import { describeDbError, fileNciiRequest, getUserStatus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { sanitizeText } from "@/lib/textFilter"
import { isReportTargetType, NCII_RELATIONSHIPS, type NciiRelationship } from "@/lib/reportTargets"
import { reportErrorResponse } from "@/lib/reportErrors"

/**
 * Intake for "Intimate image shared without consent", reached from the same
 * Report dialog. Opens a dedicated NCII case (lib/db.ts fileNciiRequest) —
 * a separate legal/safety queue with human validity review — rather than an
 * ordinary moderation report alone. The requester only identifies the
 * target by its opaque reference; post owner, image reference and any hash
 * are resolved server-side and never returned.
 */
async function handlePOST(request: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (await isRateLimited(`ncii:${userId}`, 5, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })

  let body: { targetType?: unknown; targetId?: unknown; relationship?: unknown; signatureName?: unknown; contact?: unknown; description?: unknown; goodFaith?: unknown }
  try { body = await request.json() } catch { return Response.json({ error: "invalid_request" }, { status: 400 }) }
  const relationship = NCII_RELATIONSHIPS.find((value) => value === body?.relationship) as NciiRelationship | undefined
  const signatureName = sanitizeText(body?.signatureName, 200)
  // Reachability for the review: what the requester typed, else their sign-in email.
  const contact = sanitizeText(body?.contact, 320) || session.user?.email || ""
  if (!body || !isReportTargetType(body.targetType) || typeof body.targetId !== "string" || !relationship || body.goodFaith !== true || !signatureName || !contact) {
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) return Response.json({ error: "account_unavailable" }, { status: 403 })
    await fileNciiRequest({ requesterId: userId, targetType: body.targetType, targetId: body.targetId, relationship, signatureName, contact,
      description: sanitizeText(body.description, 2000) || undefined, goodFaith: true })
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const mapped = reportErrorResponse(error)
    if (mapped) return mapped
    log.error("reports/ncii: failed", { ...describeDbError(error) })
    return Response.json({ error: "report_unavailable" }, { status: 500 })
  }
}

export const POST = withHttpMetrics("/app/api/reports/ncii", handlePOST)
