import { createHmac, timingSafeEqual } from "node:crypto"

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

export function mintTicket(userId: string): string {
  const payload = JSON.stringify({ sub: userId, exp: Date.now() + TICKET_TTL_MS })
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url")
  const signature = createHmac("sha256", ticketKey()).update(encodedPayload).digest("base64url")
  return `${encodedPayload}.${signature}`
}

export function verifyTicket(ticket: string): { userId: string } | null {
  if (typeof ticket !== "string" || !ticket.includes(".")) return null
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
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown }
    if (typeof payload.sub !== "string" || !payload.sub) return null
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null
    return { userId: payload.sub }
  } catch {
    return null
  }
}
