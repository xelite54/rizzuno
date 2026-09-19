import { withHttpMetrics } from "@/lib/httpMetrics"
import { auth } from "@/auth"
import { hasRizzPlus, getBillingCustomer } from "@/lib/db"

async function handleGET() {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ active: false, canManage: false }, { headers: { "Cache-Control": "no-store" } })
  try {
    const [active, customer] = await Promise.all([hasRizzPlus(userId), getBillingCustomer(userId)])
    return Response.json({ active, canManage: !!customer }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "billing_unavailable" }, { status: 503 }) }
}

export const GET = withHttpMetrics("/app/api/billing/status", handleGET)
