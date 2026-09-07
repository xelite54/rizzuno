import { auth } from "@/auth"
import { getUserStatus, grantFreeRizzPlus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

// TEMPORARY — Rizz+ has no real charge behind it right now: this grants
// membership directly instead of creating a Stripe checkout session (see
// grantFreeRizzPlus in lib/db.ts). Swap the body back to a real
// stripe.checkout.sessions.create call (still in git history) once billing
// is ready to charge again.
export async function POST(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (isRateLimited(`checkout:${userId}`, 5, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 })
  try {
    // Free activation does not create external redirects and needs no
    // Stripe/APP_URL configuration. Still reject cross-origin POSTs.
    const origin = new URL(request.url).origin
    if (request.headers.get("origin") !== origin) return Response.json({ error: "invalid_origin" }, { status: 403 })
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted || (status.suspendedUntil && status.suspendedUntil > Date.now())) return Response.json({ error: "account_unavailable" }, { status: 403 })
    // The grant is one atomic UPSERT keyed by user. A separate transaction
    // lock is unnecessary and would hold a second pool connection.
    await grantFreeRizzPlus(userId)
    return Response.json({ active: true, testMode: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("billing checkout failed", error instanceof Error ? error.message : "unknown")
    return Response.json({ error: "billing_unavailable" }, { status: 503 })
  }
}
