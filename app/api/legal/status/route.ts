import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { hasAcceptedCurrent, describeDbError } from "@/lib/db"

/** Whether the signed-in account has accepted the currently-required version of every required document (age 18+, Terms, Privacy). Drives whether AgeGate blocks matchmaking. */
export async function GET() {
  let userId: string | undefined
  try {
    const session = await auth()
    userId = session?.user?.id
  } catch (err) {
    console.error("legal/status: auth() itself threw", describeDbError(err))
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  try {
    return NextResponse.json({ accepted: await hasAcceptedCurrent(userId) })
  } catch (err) {
    // A real failure (e.g. the database being unreachable, or misconfigured
    // for the connection-pooling mode it's actually deployed against) — not
    // treated as "accepted" (never bypasses acceptance), but also not
    // silently treated as "not yet accepted" either: the client (see
    // useLegalAcceptance.ts) now surfaces a non-ok response here as a
    // distinct "error" state instead of quietly re-showing AgeGate as if
    // this were a normal first-time flow.
    console.error("legal/status: failed to check acceptance", { userId, ...describeDbError(err) })
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
