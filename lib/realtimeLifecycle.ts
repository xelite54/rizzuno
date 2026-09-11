import { WS_CLOSE_SUPERSEDED } from "./signaling/protocol"

export function resolveRealtimeAccount(previous: string | undefined, current: string | undefined, status: string) {
  if (status === "unauthenticated") return undefined
  return current || (status === "loading" ? previous : undefined)
}

/**
 * Whether a just-closed transport should be allowed to auto-reconnect —
 * false for exactly one case: the server closed it with WS_CLOSE_SUPERSEDED
 * because another, already-healthy connection for this same account exists
 * elsewhere (see server/ws-server.ts's hello handler and that constant's
 * own doc comment). Reconnecting from THAT close would just walk straight
 * back into the same ownership check and lose again — before this
 * existed, that blind "every close retries" behavior is exactly what
 * turned one duplicate tab/device into an infinite replace/reconnect fight
 * between two sockets for one account. Every other close code — a real
 * network drop, an unclean disconnect, a server restart, anything else —
 * still reconnects normally; this must never become a blanket "stop
 * retrying" switch. The only caller is useSignalingSocket.ts's `onclose`.
 */
export function shouldReconnectAfterClose(code: number): boolean {
  return code !== WS_CLOSE_SUPERSEDED
}

/**
 * How many times a superseded close is allowed to retry anyway, and how
 * long to wait first — see useSignalingSocket.ts's `onclose` handler for
 * the full reasoning. In short: "superseded" doesn't only mean a genuine
 * second device is actively using this account right now — the exact same
 * close also happens when a device's OWN previous connection died
 * silently (mobile backgrounding, a network drop) but still looked
 * healthy to the server for a while. Treating every superseded close as
 * permanent left that case stuck on a dead connection until a manual
 * reload, even once the real owner (its own stale old connection) was
 * long gone.
 *
 * SUPERSEDED_RETRY_DELAY_MS is deliberately comfortably longer than
 * server/ws-server.ts's own 20s heartbeat interval — a connection that
 * dies right after answering one ping isn't reaped until nearly two full
 * heartbeat cycles later (it still looks alive through the cycle right
 * after it actually died), so waiting less than that would just retry
 * into the same rejection.
 */
export const MAX_SUPERSEDED_RETRIES = 1
export const SUPERSEDED_RETRY_DELAY_MS = 45_000

/**
 * Whether (and after how long) a superseded socket should retry — null
 * means give up for good. Pure so the bounded-retry decision itself is
 * testable without real timers/sockets; useSignalingSocket.ts owns
 * actually scheduling it. Deliberately a small, bounded count on a long,
 * deliberate delay — never the fast ~500ms backoff a normal network close
 * uses — so a genuinely still-active duplicate device just gets
 * superseded again on this one retry and then stops for good, never a
 * tight loop.
 */
export function nextSupersededRetryDelayMs(retriesUsed: number): number | null {
  return retriesUsed < MAX_SUPERSEDED_RETRIES ? SUPERSEDED_RETRY_DELAY_MS : null
}

export function canSearch(roomId: string | null) { return roomId === null }
export function isCurrentRoom(roomId: string | null, incoming: string) { return roomId !== null && roomId === incoming }

export function retainRealtime(admittedAccount: string | undefined, account: string | undefined, legal: string, hydrated: boolean, onboarded: boolean) {
  if (!account || legal === "required") return false
  if (legal === "accepted" && hydrated && onboarded) return true
  // Admission is latched to the authenticated account. Profile hydration
  // and editing are not session teardown signals.
  return admittedAccount === account
}
