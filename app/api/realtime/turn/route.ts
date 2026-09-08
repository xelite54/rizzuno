import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { mintTurnCredential } from "@/lib/turnCredentials"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * Mints a short-lived TURN credential (see lib/turnCredentials.ts) for the
 * currently-authenticated session — the only way a browser ever gets one.
 * Requires a real Auth.js session the same way app/api/realtime/ticket
 * does: no anonymous credential issuance. hooks/useWebRTC.ts calls this
 * proactively in the background (not per-call, not per-ICE-candidate) and
 * caches the result client-side until shortly before it expires.
 *
 * `{ configured: false }` (200, not an error) means this deployment simply
 * doesn't have TURN set up (NEXT_PUBLIC_TURN_URL and/or
 * TURN_STATIC_AUTH_SECRET unset) — the client falls back to STUN-only, or
 * to a legacy static NEXT_PUBLIC_TURN_USERNAME/CREDENTIAL if one happens
 * to still be configured, exactly like an unconfigured TURN always has in
 * this codebase.
 */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }
  // Generous but real — a fresh credential is fetched on connect and
  // proactively refreshed well before its own expiry (see
  // hooks/useWebRTC.ts), never per-call or per-ICE-candidate, so this
  // limit is about catching a runaway/malicious client, not routine use.
  if (isRateLimited(`turn-credentials:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  // A random, opaque per-request label — never the real account id (see
  // mintTurnCredential's own doc comment on why).
  const minted = mintTurnCredential(randomUUID())
  if (!minted) {
    return NextResponse.json({ configured: false }, { headers: { "Cache-Control": "no-store" } })
  }
  // NEVER logged — see server/ws-server.ts's own "never log TURN
  // credentials" rule, which applies here identically even though this is
  // the Next.js app, not the realtime server.
  return NextResponse.json({ configured: true, ...minted }, { headers: { "Cache-Control": "no-store" } })
}
