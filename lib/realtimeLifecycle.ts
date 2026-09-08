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

export function canSearch(roomId: string | null) { return roomId === null }
export function isCurrentRoom(roomId: string | null, incoming: string) { return roomId !== null && roomId === incoming }

export function retainRealtime(admittedAccount: string | undefined, account: string | undefined, legal: string, hydrated: boolean, onboarded: boolean) {
  if (!account || legal === "required") return false
  if (legal === "accepted" && hydrated && onboarded) return true
  return admittedAccount === account && (legal === "checking" || legal === "error" || !hydrated)
}
