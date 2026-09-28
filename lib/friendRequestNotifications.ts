/** Most friend-request toasts on screen at once; the rest are only in the Friends panel's inbox. */
export const MAX_FRIEND_REQUEST_TOASTS = 2

export function notifiedFriendRequestsKey(accountId: string): string {
  return `rizzuno:notified-friend-requests:${accountId}`
}

/**
 * Pure core of takeUnnotifiedFriendRequests: which pending ids are new, and
 * the notified set to store next (pruned to what's still pending, so it
 * never grows without bound).
 */
export function diffNotifiedFriendRequests(notified: ReadonlySet<string>, pendingIds: readonly string[]): { fresh: string[]; nextNotified: string[] } {
  return {
    fresh: pendingIds.filter((id) => !notified.has(id)),
    nextNotified: [...pendingIds],
  }
}

// Used when localStorage is unavailable: notifications then fall back to
// once per page load instead of once per account.
const memoryFallback = new Map<string, Set<string>>()

/**
 * Returns the pending request ids this account has never been notified
 * about, and records them all as notified, so each request pops up once,
 * even across reloads.
 */
export function takeUnnotifiedFriendRequests(accountId: string, pendingIds: readonly string[]): string[] {
  const key = notifiedFriendRequestsKey(accountId)
  let notified = memoryFallback.get(key) ?? new Set<string>()
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) notified = new Set([...notified, ...parsed.filter((id): id is string => typeof id === "string")])
  } catch { /* Storage unavailable or corrupt; use the in-memory set. */ }
  const { fresh, nextNotified } = diffNotifiedFriendRequests(notified, pendingIds)
  memoryFallback.set(key, new Set(nextNotified))
  try { localStorage.setItem(key, JSON.stringify(nextNotified)) } catch { /* Best effort. */ }
  return fresh
}
