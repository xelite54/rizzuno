import { withHttpMetrics } from "@/lib/httpMetrics"
import { billingMode } from "@/lib/billingMode"
import { csrfGuard } from "@/lib/requestSecurity"
import { auth } from "@/auth"
import { cancelFreeRizzPlus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

async function handlePOST(request: Request) {
  billingMode()
  const rejected = csrfGuard(request)
  if (rejected) return rejected
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "invalid_origin" }, { status: 403 })
  if (await isRateLimited(`cancel-plus:${userId}`, 5, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  try {
    // This only revokes the test grant. Real paid subscriptions are
    // canceled through the authenticated Stripe customer portal.
    await cancelFreeRizzPlus(userId)
    return Response.json({ canceled: true }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "cancellation_unavailable" }, { status: 503 }) }
}

export const POST = withHttpMetrics("/app/api/billing/cancel", handlePOST)
