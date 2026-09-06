import { auth } from "@/auth"
import { claimAccountGender, getUserStatus } from "@/lib/db"
import { isValidGender } from "@/lib/signaling/protocol"

export async function PUT(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  try {
    const { gender } = await request.json()
    if (!isValidGender(gender)) return Response.json({ error: "invalid_gender" }, { status: 400 })
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) return Response.json({ error: "account_unavailable" }, { status: 403 })
    if (!await claimAccountGender(userId, gender)) return Response.json({ error: "subscription_required" }, { status: 402 })
    return Response.json({ gender })
  } catch { return Response.json({ error: "save_failed" }, { status: 503 }) }
}
