/**
 * Pure decision logic for hooks/useWebRTC.ts's tiered connection-recovery
 * mechanism — pulled out for the same reason lib/matchStateMachine.ts and
 * lib/realtimeLifecycle.ts are their own modules: testable without a
 * browser/RTCPeerConnection. useWebRTC.ts owns actually acting on these
 * decisions (scheduling timers, closing/creating RTCPeerConnections); this
 * file only ever decides WHAT to do given a state.
 *
 * The full tiered recovery this backs:
 *
 *   connected -> disconnected -> (short grace window) -> still disconnected?
 *     -> ICE restart (existing, bounded to one attempt — lib/rtcNegotiation.ts)
 *     -> if that doesn't resolve within its own deadline: ONE fresh
 *        RTCPeerConnection for the same room, reusing the same tracks
 *     -> if THAT also doesn't resolve: give up, leave the room normally
 *
 * `failed` skips the grace window (nothing to wait out — it's already a
 * terminal ICE state); `disconnected` gets the grace window first, since
 * it's exactly the state a brief Wi-Fi hiccup or network handoff produces
 * on its own, often self-resolving within a couple of seconds with no
 * recovery action needed at all.
 */

export type ConnectionHealthState = "connected" | "disconnected" | "failed" | "other"

export type RecoveryAction = "recover-now" | "grace-then-recover" | "clear-grace" | "none"

/**
 * What to do about a `connectionState`/`iceConnectionState` transition —
 * called from both (they mostly move together, but either can lead) with
 * the SAME shared grace-timer state in useWebRTC.ts, so a genuinely
 * healthy connection only ever needs one "clear-grace" to cancel whichever
 * of the two fired the pending grace timer.
 */
export function decideConnectionRecoveryAction(state: ConnectionHealthState): RecoveryAction {
  switch (state) {
    case "failed":
      return "recover-now"
    case "disconnected":
      return "grace-then-recover"
    case "connected":
      return "clear-grace"
    case "other":
      return "none"
  }
}

export type PostIceRecoveryDecision = "attempt-fresh-connection" | "give-up"

/**
 * Once the existing bounded ICE-restart deadline (lib/rtcNegotiation.ts's
 * own one-shot `recover()`, given ICE_RECOVERY_DEADLINE_MS to actually
 * resolve) is exceeded without recovering, decide whether this room still
 * gets the ONE additional fresh-RTCPeerConnection recovery level, or
 * whether that's already been used (either by an earlier failure in this
 * same room, or because the fresh connection itself just went through the
 * exact same "ICE restart deadline exceeded" path a second time) and it's
 * time to genuinely give up and leave the room instead.
 */
export function decideAfterIceRecoveryDeadline(freshConnectionRecoveryAlreadyUsed: boolean): PostIceRecoveryDecision {
  return freshConnectionRecoveryAlreadyUsed ? "give-up" : "attempt-fresh-connection"
}
