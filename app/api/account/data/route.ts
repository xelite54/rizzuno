import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { exportUserData } from "@/lib/db"

/** Self-service data export: the subset of this account's server-side records exposed by exportUserData() (status, legal-acceptance history, blocks made, reports filed) — not every row that mentions this account (e.g. reports where it was the one reported, or moderation-action details, both left out today). Profile content (username/bio/photo/posts) isn't included because it isn't stored server-side at all — see useMyProfile.ts, which keeps it in the browser's own localStorage where the user already has direct access to it. */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  return NextResponse.json(await exportUserData(userId))
}
