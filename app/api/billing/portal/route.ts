import { auth } from "@/auth"
import { getBillingCustomer } from "@/lib/db"
import { billingOrigin, stripeClient } from "@/lib/billing"
import { isRateLimited } from "@/lib/apiRateLimit"

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (isRateLimited(`portal:${userId}`, 10, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 })
  try {
    const origin = billingOrigin()
    if (request.headers.get("origin") !== origin) return Response.json({ error: "invalid_origin" }, { status: 403 })
    const customer = await getBillingCustomer(userId)
    if (!customer) return Response.json({ error: "no_subscription" }, { status: 404 })
    const portal = await stripeClient().billingPortal.sessions.create({ customer, return_url: `${origin}/rizz-plus` })
    return Response.json({ url: portal.url })
  } catch { return Response.json({ error: "billing_unavailable" }, { status: 503 }) }
}
