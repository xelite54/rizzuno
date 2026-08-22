import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { recordAcceptance, getUserStatus } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Records that the signed-in account affirmed they're 18+ and accepted the
 * current Terms and Privacy Policy — all three together, since AgeGate
 * presents them as one combined affirmation. This is a factual record
 * ("this account clicked accept on version X on date Y"), not identity-level
 * age verification — nothing here proves the person's real age.
 */
export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`legal-accept:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const status = await getUserStatus(userId)
  if (status.banned || status.deleted) {
    return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
  }

  await recordAcceptance(userId)
  return NextResponse.json({ ok: true })
}
