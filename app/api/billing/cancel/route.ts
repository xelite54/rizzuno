import { auth } from "@/auth"
import { cancelFreeRizzPlus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "invalid_origin" }, { status: 403 })
  if (isRateLimited(`cancel-plus:${userId}`, 5, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 })
  try {
    // This only revokes the test grant. Real paid subscriptions are
    // canceled through the authenticated Stripe customer portal.
    await cancelFreeRizzPlus(userId)
    return Response.json({ canceled: true }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "cancellation_unavailable" }, { status: 503 }) }
}
