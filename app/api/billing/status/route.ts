import { auth } from "@/auth"
import { hasRizzPlus, getBillingCustomer } from "@/lib/db"

export async function GET() {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ active: false, canManage: false }, { headers: { "Cache-Control": "no-store" } })
  try {
    const [active, customer] = await Promise.all([hasRizzPlus(userId), getBillingCustomer(userId)])
    return Response.json({ active, canManage: !!customer }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "billing_unavailable" }, { status: 503 }) }
}
