import Stripe from "stripe"
import { getBillingCustomer, saveBillingCustomer, saveBillingSubscription } from "./db"

export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("billing_not_configured")
  return new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 15_000, maxNetworkRetries: 2 })
}

export function billingOrigin() {
  const url = new URL(process.env.APP_URL ?? "http://localhost:3000")
  if (process.env.NODE_ENV === "production" && (!process.env.APP_URL || url.protocol !== "https:")) throw new Error("billing_origin_not_configured")
  return url.origin
}

export async function rizzPlusPrice(stripe: Stripe) {
  if (!process.env.STRIPE_RIZZ_PLUS_PRICE_ID) throw new Error("billing_price_not_configured")
  const price = await stripe.prices.retrieve(process.env.STRIPE_RIZZ_PLUS_PRICE_ID)
  if (!price.active || price.currency !== "usd" || price.unit_amount !== 499 || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) throw new Error("billing_price_must_be_usd_499_monthly")
  return price.id
}

export async function billingCustomer(stripe: Stripe, userId: string) {
  const existing = await getBillingCustomer(userId)
  if (existing) return existing
  const customer = await stripe.customers.create({ metadata: { userId } }, { idempotencyKey: `rizz-plus-customer:${userId}` })
  await saveBillingCustomer(userId, customer.id)
  return (await getBillingCustomer(userId))!
}

export async function syncSubscription(stripe: Stripe, subscriptionId: string, eventCreated: number) {
  // Re-read current Stripe state: delayed webhook delivery must not restore
  // an old active snapshot after cancellation or failed payment.
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const item = sub.items.data.find((entry) => entry.price.id === process.env.STRIPE_RIZZ_PLUS_PRICE_ID)
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const status = item && item.quantity === 1 && !sub.pause_collection ? sub.status : "ineligible"
  await saveBillingSubscription(customer, sub.id, status, item ? item.current_period_end * 1000 : 0, eventCreated)
}
