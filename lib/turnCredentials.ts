import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Short-lived TURN credential minting — replaces long-lived
 * NEXT_PUBLIC_TURN_USERNAME/CREDENTIAL (a permanent secret baked into the
 * shipped browser bundle, readable by anyone who opens devtools) with
 * per-session credentials that expire on their own.
 *
 * Uses the "TURN REST API" convention: username = "<unix-expiry-
 * seconds>:<label>", credential = base64(HMAC-SHA1(secret, username)).
 * This is a de facto industry standard — it's exactly what coturn's own
 * `--use-auth-secret`/`--static-auth-secret` mode implements, and what
 * most commercial TURN providers built on coturn (ExpressTURN's own setup
 * docs describe a "TURN REST API" / "Auth Secret" option in this same
 * shape) support without any provider-specific API call: minting a
 * credential is a pure, local HMAC computation against a shared secret —
 * nothing here ever calls out to the TURN provider itself. The TURN
 * server verifies a request by recomputing the same HMAC with its own
 * copy of the secret and checking the embedded expiry, so nothing at the
 * TURN provider needs to be told about each credential ahead of time.
 *
 * `TURN_STATIC_AUTH_SECRET` (server-only, deliberately never
 * NEXT_PUBLIC_*) is that shared secret, configured on both this app and
 * the TURN server's own dashboard/config. Unset (or NEXT_PUBLIC_TURN_URL
 * unset) means TURN isn't configured at all — mintTurnCredential returns
 * null rather than throwing, and callers fall back to STUN-only, exactly
 * like an unconfigured TURN always has in this codebase.
 *
 * IMPORTANT — code support here is not the same thing as this actually
 * being active in production. This client/server pair only ever mints a
 * credential in the shape ExpressTURN's own "TURN REST API"/"Auth
 * Secret"/shared-secret authentication documents; it does not, and
 * cannot from here, confirm that a given ExpressTURN account/plan has
 * that mode actually turned on, or that TURN_STATIC_AUTH_SECRET here
 * matches whatever secret is configured on ExpressTURN's own side. Check
 * ExpressTURN's dashboard directly for that, and see the dev-only
 * "webrtc: TURN is configured for this connection attempt" log in
 * hooks/useWebRTC.ts plus getStats()'s own candidateType (host/srflx/
 * relay) for what a REAL connection attempt actually reveals once
 * deployed.
 */

/**
 * How long a minted credential remains valid. Long — 24 hours, matching
 * ExpressTURN's own documented temporary-credential example — deliberately
 * NOT sized to "a bit longer than one call": the module-level cache this
 * backs (see hooks/useWebRTC.ts's refreshTurnCredentials/buildIceServers)
 * only ever affects which credential a NEW RTCPeerConnection is
 * constructed with. A credential already baked into an EXISTING, ACTIVE
 * RTCPeerConnection is never swapped out from under it — this codebase
 * doesn't call `setConfiguration()` to rotate a live connection's ICE
 * servers, on purpose, to keep this change scoped to credential issuance
 * only. That means a call (or this file's own fresh-connection recovery,
 * which reuses buildIceServers() for its own new pc but still never
 * touches an already-running one) must never be allowed to run into an
 * ALREADY-EXPIRED credential simply because the call outlasted a
 * short TTL — 24 hours comfortably exceeds any realistic call duration,
 * closing that risk without needing live-rotation complexity. Short
 * enough that a leaked credential still isn't a standing secret — a
 * fresh one is minted well before this elapses either way (the client
 * proactively refetches — see TURN_REFRESH_MARGIN_SECONDS in
 * hooks/useWebRTC.ts).
 */
export const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60

export type MintedTurnCredential = {
  urls: string[]
  username: string
  credential: string
  ttlSeconds: number
}

function authSecret(): string | null {
  const secret = process.env.TURN_STATIC_AUTH_SECRET
  return secret && secret.length > 0 ? secret : null
}

function turnUrls(): string[] | null {
  const raw = process.env.NEXT_PUBLIC_TURN_URL
  if (!raw) return null
  const urls = raw.split(",").map((u) => u.trim()).filter(Boolean)
  return urls.length > 0 ? urls : null
}

/** Whether short-lived TURN credential issuance is actually configured in this deployment — both a TURN host list AND the shared auth secret must be set; either alone isn't enough to mint anything usable. */
export function turnCredentialsConfigured(): boolean {
  return authSecret() !== null && turnUrls() !== null
}

/**
 * Mints one short-lived credential. `label` is an opaque, per-request
 * correlation token for the TURN server's own logs/metrics — a random
 * value (see app/api/realtime/turn/route.ts, which passes a fresh
 * randomUUID() per request), never a real account id or anything else
 * that could identify who's calling; TURN allocations aren't normally
 * exposed to the peer, but this codebase's own rule ("prefer temporary
 * connection/debug ids over raw account ids") applies here too as
 * defense in depth. Returns null (never throws) if TURN isn't configured
 * — see turnCredentialsConfigured's own doc comment.
 */
export function mintTurnCredential(label: string, ttlSeconds: number = TURN_CREDENTIAL_TTL_SECONDS): MintedTurnCredential | null {
  const secret = authSecret()
  const urls = turnUrls()
  if (!secret || !urls) return null

  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds
  const username = `${expiry}:${label}`
  const credential = createHmac("sha1", secret).update(username).digest("base64")
  return { urls, username, credential, ttlSeconds }
}

/**
 * Verifies a previously-minted credential against the current secret and
 * expiry — never actually called by this app (the TURN SERVER is what
 * verifies these, independently, against its own copy of the same
 * secret), but exported and exercised by this file's own tests as the
 * one honest way to prove mintTurnCredential() actually produces
 * something a real, spec-following TURN REST API implementation would
 * accept: recomputing the exact same HMAC over the exact same username
 * and confirming a byte-for-byte match, timing-safely.
 */
export function verifyMintedTurnCredential(username: string, credential: string, secret: string, now: number = Date.now()): boolean {
  const separatorIndex = username.indexOf(":")
  if (separatorIndex <= 0) return false
  const expirySeconds = Number(username.slice(0, separatorIndex))
  if (!Number.isFinite(expirySeconds)) return false
  if (now > expirySeconds * 1000) return false

  const expected = createHmac("sha1", secret).update(username).digest("base64")
  const a = Buffer.from(credential)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
