import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { hasAcceptedCurrent } from "@/lib/db"

/** Whether the signed-in account has accepted the currently-required version of every required document (age 18+, Terms, Privacy). Drives whether AgeGate blocks matchmaking. */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  return NextResponse.json({ accepted: await hasAcceptedCurrent(userId) })
}
