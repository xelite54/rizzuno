import { auth } from "@/auth"
import { getUserStatus, hasRizzPlus, withBillingLock } from "@/lib/db"
import { billingCustomer, billingOrigin, rizzPlusPrice, stripeClient } from "@/lib/billing"
import { isRateLimited } from "@/lib/apiRateLimit"

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (isRateLimited(`checkout:${userId}`, 5, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 })
  try {
    const origin = billingOrigin()
    if (request.headers.get("origin") !== origin) return Response.json({ error: "invalid_origin" }, { status: 403 })
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted || (status.suspendedUntil && status.suspendedUntil > Date.now())) return Response.json({ error: "account_unavailable" }, { status: 403 })
    return await withBillingLock(userId, async () => {
      const stripe = stripeClient()
      const price = await rizzPlusPrice(stripe)
      const customer = await billingCustomer(stripe, userId)
      const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 100 })
      if (await hasRizzPlus(userId) || subscriptions.data.some((sub) => !["canceled", "incomplete_expired"].includes(sub.status))) {
        const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/rizz-plus` })
        return Response.json({ url: portal.url })
      }
      const sessions = await stripe.checkout.sessions.list({ customer, status: "open", limit: 10 })
      const open = sessions.data.find((session) => session.mode === "subscription" && session.metadata?.rizzPlusPrice === price)
      if (open?.url) return Response.json({ url: open.url })
      const checkout = await stripe.checkout.sessions.create({
        customer, mode: "subscription", line_items: [{ price, quantity: 1 }],
        metadata: { rizzPlusPrice: price }, client_reference_id: userId,
        subscription_data: { metadata: { userId } },
        success_url: `${origin}/rizz-plus?checkout=success`, cancel_url: `${origin}/rizz-plus?checkout=canceled`,
      })
      return Response.json({ url: checkout.url })
    })
  } catch (error) {
    console.error("billing checkout failed", error instanceof Error ? error.message : "unknown")
    return Response.json({ error: "billing_unavailable" }, { status: 503 })
  }
}
