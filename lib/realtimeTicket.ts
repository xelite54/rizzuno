import { createHmac, timingSafeEqual } from "node:crypto"
import { normalizeCountry, normalizeSubdivision } from "./country"
import { agePolicyForLocation } from "./agePolicy"

/**
 * Bridges an authenticated Auth.js session into the realtime WebSocket
 * server. The WS server itself never sees cookies or talks to Auth.js — it
 * only ever sees whatever the client sends in its "hello" message, and
 * previously that was a bare client-supplied string with no verification at
 * all (spec §2: "never trust a user ID supplied by the client without
 * server verification"). A ticket closes that gap: it's minted server-side,
 * only for the currently-authenticated session (see
 * app/api/realtime/ticket/route.ts), and cryptographically proves which
 * Google account id it speaks for. The WS server verifies the signature and
 * expiry itself — it never has to trust the client's claim about who they
 * are, only the ticket's signature.
 *
 * Short-lived (2 minutes) rather than reusable for a whole session: a
 * fresh one is minted every time the socket (re)connects (see
 * useMatchmaking.ts), so there's no long-lived bearer credential sitting in
 * the browser for longer than it takes to actually open one connection.
 *
 * Signed with its own dedicated `REALTIME_TICKET_SECRET` — deliberately not
 * derived from AUTH_SECRET. The Vercel app and the Railway realtime service
 * are two separate deployments now; AUTH_SECRET signs Auth.js's own session
 * JWTs and has no reason to exist on the realtime host at all, while this
 * secret has no reason to exist anywhere Auth.js itself doesn't need it
 * verified. Keeping them separate means rotating one is never a question of
 * "wait, what else does this affect."
 */

const TICKET_TTL_MS = 2 * 60 * 1000

function ticketKey(): Buffer {
  const secret = process.env.REALTIME_TICKET_SECRET
  if (!secret) throw new Error("REALTIME_TICKET_SECRET is not configured")
  return createHmac("sha256", secret).update("rizzuno:realtime-ticket:v1").digest()
}

type AgeAccess = { ageExpiresAt?: number; agePolicyKey?: string; subdivision?: string | null }
export function realtimeLocationAllowed(access: AgeAccess & { countryCode?: string }) {
  const policy = agePolicyForLocation(access.countryCode ?? null, access.subdivision ?? null)
  return !!policy && policy.mode !== "unavailable"
}
export function realtimeAgeAllowed(access: AgeAccess & { countryCode?: string }) {
  if (!access.ageExpiresAt || !access.agePolicyKey) return false
  const policy = agePolicyForLocation(access.countryCode ?? null, access.subdivision ?? null)
  return access.ageExpiresAt > Date.now() && !!policy && policy.mode !== "unavailable" && policy.key === access.agePolicyKey
}

export function mintTicket(userId: string, countryCode?: string | null, ageAccess?: AgeAccess): string {
  const payload = JSON.stringify({ version: 2, sub: userId, exp: Date.now() + TICKET_TTL_MS, countryCode: normalizeCountry(countryCode), ...ageAccess })
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url")
  const signature = createHmac("sha256", ticketKey()).update(encodedPayload).digest("base64url")
  return `${encodedPayload}.${signature}`
}

export function verifyTicket(ticket: string): ({ userId: string; countryCode?: string } & AgeAccess) | null {
  if (typeof ticket !== "string" || ticket.length > 2048 || ticket.split(".").length !== 2) return null
  const [encodedPayload, signature] = ticket.split(".")
  if (!encodedPayload || !signature) return null

  let expectedSignature: string
  try {
    expectedSignature = createHmac("sha256", ticketKey()).update(encodedPayload).digest("base64url")
  } catch {
    return null
  }

  const a = Buffer.from(signature)
  const b = Buffer.from(expectedSignature)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { version?: unknown; sub?: unknown; exp?: unknown; countryCode?: unknown; ageExpiresAt?: unknown; agePolicyKey?: unknown; subdivision?: unknown }
    if (payload.version !== 2) return null
    if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 200) return null
    if (typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || Date.now() >= payload.exp || payload.exp > Date.now() + TICKET_TTL_MS) return null
    const countryCode = normalizeCountry(payload.countryCode)
    const ageAccess = payload.ageExpiresAt !== undefined ? { ageExpiresAt: Number.isSafeInteger(payload.ageExpiresAt) ? Number(payload.ageExpiresAt) : 0, agePolicyKey: typeof payload.agePolicyKey === "string" ? payload.agePolicyKey : "", subdivision: normalizeSubdivision(payload.subdivision) } : {}
    const access = { userId: payload.sub, ...(countryCode ? { countryCode } : {}), ...ageAccess }
    return realtimeAgeAllowed(access) ? access : null
  } catch {
    return null
  }
}
