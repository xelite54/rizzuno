import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { mintTurnCredential } from "@/lib/turnCredentials"
import { checkAndIncrementTurnCredentialRateLimit, describeDbError } from "@/lib/db"

// ~20 requests/account/minute — a fresh credential is fetched on connect
// and proactively refreshed well before its own expiry (see
// hooks/useWebRTC.ts), never per-call or per-ICE-candidate, so this limit
// is about catching a runaway/malicious client, not routine use. Enforced
// via lib/db.ts's checkAndIncrementTurnCredentialRateLimit — a shared,
// Postgres-backed fixed-window counter, not lib/apiRateLimit.ts's
// in-memory one (which is per-process and therefore not authoritative
// across Vercel's multiple serverless instances for this route
// specifically — see that function's own doc comment for the full
// reasoning).
const TURN_CREDENTIAL_RATE_LIMIT = 20
const TURN_CREDENTIAL_RATE_WINDOW_MS = 60_000

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

  let limited: boolean
  try {
    limited = await checkAndIncrementTurnCredentialRateLimit(userId, TURN_CREDENTIAL_RATE_LIMIT, TURN_CREDENTIAL_RATE_WINDOW_MS)
  } catch (err) {
    // FAIL CLOSED — a database failure must never be read as "not rate
    // limited" and mint an unlimited credential; see
    // checkAndIncrementTurnCredentialRateLimit's own doc comment. The
    // client's own fallback (any non-2xx response here just means "no
    // fresh ephemeral credential this time" — see refreshTurnCredentials()
    // in hooks/useWebRTC.ts) handles this the same safe way it handles a
    // genuine rate limit: STUN-only, or the legacy static TURN vars if
    // configured, until the next scheduled retry.
    console.error("realtime/turn: rate limit check failed — failing closed, no credential issued", describeDbError(err))
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
  if (limited) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store" } })
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
