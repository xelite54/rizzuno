import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { deleteAccount } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Server-side account deletion. There's very little to actually delete
 * server-side (see lib/db.ts's header) — this marks the account deleted
 * (blocking future sign-in from reaching matchmaking, see
 * app/api/realtime/ticket/route.ts) while deliberately preserving any real
 * ban/suspension record and legal-acceptance history, per the retention
 * carve-out for enforcement/legal records. Client-side profile data
 * (username/bio/photo/posts) lives in the browser only (useMyProfile.ts)
 * and is the browser's to clear, not this endpoint's.
 */
export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  if (isRateLimited(`account-delete:${userId}`, 5, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  await deleteAccount(userId)
  return NextResponse.json({ ok: true })
}
