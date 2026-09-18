import { billingMode } from "@/lib/billingMode"
import { csrfGuard } from "@/lib/requestSecurity"
import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"

export async function POST(request: Request) {
  billingMode()
  const rejected = csrfGuard(request)
  if (rejected) return rejected
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (await isRateLimited(`portal:${userId}`, 10, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  return Response.json({ error: "free_membership_has_no_billing_portal" }, { status: 409 })
}
