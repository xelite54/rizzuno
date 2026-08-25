/**
 * A minimal in-memory rate limiter for authenticated API routes/actions —
 * same sliding-window shape as the WebSocket server's own limiter (see
 * server/ws-server.ts), applied here to account-mutating HTTP endpoints
 * (accept terms, claim a username, admin moderation actions) so a runaway
 * client or script can't hammer them. Per-process, in-memory — resets on
 * restart and doesn't coordinate across multiple instances, which is fine
 * for the current single-process deployment; a multi-instance deployment
 * would want a shared store (e.g. the same database) instead.
 */

const buckets = new Map<string, number[]>()

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = buckets.get(key) ?? []
  const recent = timestamps.filter((ts) => now - ts < windowMs)
  recent.push(now)
  buckets.set(key, recent)
  return recent.length > limit
}
