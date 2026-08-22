import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { mintTicket } from "@/lib/realtimeTicket"
import { getUserStatus, hasAcceptedCurrent } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * The only bridge between an authenticated Auth.js session and the
 * unauthenticated-by-transport WebSocket server. The client calls this
 * (with its session cookie) whenever it (re)connects, and hands the
 * returned ticket to the WS server in its "hello" message — see
 * lib/realtimeTicket.ts for why a short-lived signed ticket rather than
 * the session cookie itself.
 *
 * Also where account-status gating actually starts: a banned/suspended/
 * deleted account never even receives a ticket, so it can't reach the
 * matchmaking queue at all — checked again on the WS side too (see
 * server/ws-server.ts) as defense in depth against a ticket minted just
 * before a ban took effect.
 */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  // Generous — a fresh ticket is minted on every reconnect and every
  // profile-field edit (see useMatchmaking.ts's `announce`), both of which
  // are normal, if this account is behaving itself.
  if (isRateLimited(`realtime-ticket:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const status = await getUserStatus(userId)
  if (status.deleted) {
    return NextResponse.json({ error: "account_deleted" }, { status: 403 })
  }
  if (status.banned) {
    return NextResponse.json({ error: "banned", reason: status.banReason }, { status: 403 })
  }
  if (status.suspendedUntil) {
    return NextResponse.json({ error: "suspended", until: status.suspendedUntil }, { status: 403 })
  }
  if (!(await hasAcceptedCurrent(userId))) {
    return NextResponse.json({ error: "acceptance_required" }, { status: 403 })
  }

  return NextResponse.json({ ticket: mintTicket(userId) })
}
