import { withHttpMetrics } from "@/lib/httpMetrics"
import { billingMode } from "@/lib/billingMode"
import { stripeClient, syncSubscription } from "@/lib/billing"
import type Stripe from "stripe"

export const runtime = "nodejs"
async function handlePOST(request: Request) {
  if (billingMode() === "free_test") return Response.json({ error: "billing_disabled" }, { status: 503 })
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_RIZZ_PLUS_PRICE_ID) return Response.json({ error: "not_configured" }, { status: 503 })
  const signature = request.headers.get("stripe-signature")
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 })
  let event: Stripe.Event
  const stripe = stripeClient()
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch { return Response.json({ error: "invalid_signature" }, { status: 400 }) }
  try {
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      await syncSubscription(stripe, (event.data.object as Stripe.Subscription).id, event.created)
    }
    return Response.json({ received: true })
  } catch {
    // Non-2xx asks Stripe to retry; never acknowledge a failed database write.
    return Response.json({ error: "sync_failed" }, { status: 500 })
  }
}

export const POST = withHttpMetrics("/app/api/billing/webhook", handlePOST)
