import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { exportUserData } from "@/lib/db"

/** Basic data-export: everything Rizzuno's server actually holds about this account. Profile content (username/bio/photo/posts) isn't included because it isn't stored server-side at all — see useMyProfile.ts, which keeps it in the browser's own localStorage where the user already has direct access to it. */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  return NextResponse.json(await exportUserData(userId))
}
