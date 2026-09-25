import { locationAllowed } from "@/lib/launchReadiness"
import { withHttpMetrics } from "@/lib/httpMetrics"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { mintTicket } from "@/lib/realtimeTicket"
import { getUserStatus, hasAcceptedCurrent } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { requestCountry, requestUsRegion } from "@/lib/country"

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
async function handleGET(request: Request) {
  if (!locationAllowed(requestCountry(request), requestUsRegion(request))) return NextResponse.json({ error: "region_unavailable" }, { status: 451 })
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  // Generous — a fresh ticket is minted on every reconnect and every
  // profile-field edit (see useMatchmaking.ts's `announce`), both of which
  // are normal, if this account is behaving itself.
  if (await isRateLimited(`realtime-ticket:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  }

  const status = await getUserStatus(userId)
  if (status.deleted) {
    return NextResponse.json({ error: "account_deleted" }, { status: 403 })
  }
  if (status.banned) {
    return NextResponse.json({ error: "banned", reason: "Your account is restricted under the Community Guidelines." }, { status: 403 })
  }
  if (status.suspendedUntil) {
    return NextResponse.json({ error: status.temporaryAction === "restrict" ? "restricted" : "suspended", until: status.suspendedUntil }, { status: 403 })
  }
  if (!(await hasAcceptedCurrent(userId))) {
    return NextResponse.json({ error: "acceptance_required" }, { status: 403 })
  }

  return NextResponse.json({ ticket: mintTicket(userId, requestCountry(request)) }, { headers: { "Cache-Control": "no-store" } })
}

export const GET = withHttpMetrics("/app/api/realtime/ticket", handleGET)
