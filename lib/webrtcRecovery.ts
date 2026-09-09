/**
 * Pure decision logic for hooks/useWebRTC.ts's connection-recovery state
 * machine — pulled out for the same reason lib/matchStateMachine.ts and
 * lib/realtimeLifecycle.ts are their own modules: testable without a
 * browser/RTCPeerConnection. useWebRTC.ts owns actually acting on these
 * decisions (scheduling timers, calling lib/rtcNegotiation.ts's recover(),
 * tearing down the room); this file only ever decides WHAT to do given a
 * state.
 *
 * The full recovery this backs — deliberately simple, deliberately bounded,
 * on the room's one and only RTCPeerConnection (see hooks/useWebRTC.ts's
 * own doc comment — there is no automatic fresh-RTCPeerConnection tier):
 *
 *   connected -> disconnected -> wait 5s (a brief Wi-Fi hiccup or network
 *     handoff is common and often self-resolves with no action needed)
 *     -> still unhealthy? -> ONE ICE restart, on the SAME RTCPeerConnection
 *     -> that restart doesn't resolve within its own deadline, or the
 *        connection fails again before it does -> the room is cleanly
 *        terminated. No further attempts, ever, for this same problem.
 *
 * `failed` skips the grace window (nothing to wait out — it's already a
 * terminal ICE state); `disconnected` gets the grace window first.
 */

export type ConnectionHealthState = "connected" | "disconnected" | "failed" | "other"

export type RecoveryAction = "recover-now" | "grace-then-recover" | "clear-grace" | "none" | "terminate"

/**
 * `recoveryUsed` — is the one restart for the CURRENT problem already
 * spent (see lib/rtcNegotiation.ts's own recoveryAvailable(), the actual
 * source of truth this is read from)? If so, a fresh disconnected/failed
 * report is the SAME still-unresolved problem showing up again, not a new
 * one worth another attempt — "never loop" means this terminates instead.
 */
export function decideConnectionRecoveryAction(state: ConnectionHealthState, recoveryUsed: boolean): RecoveryAction {
  switch (state) {
    case "connected":
      return "clear-grace"
    case "other":
      return "none"
    case "failed":
      return recoveryUsed ? "terminate" : "recover-now"
    case "disconnected":
      return recoveryUsed ? "terminate" : "grace-then-recover"
  }
}
