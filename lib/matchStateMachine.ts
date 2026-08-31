/**
 * The pure matchmaking-status state-transition rules — pulled out of
 * hooks/useMatchmaking.ts specifically so they're testable without a
 * browser/React test environment (same reasoning as lib/signalBacklog.ts's
 * own extraction — see its doc comment). This file has no dependency on
 * React, WebSockets, or timers; the hook is what actually calls `send()`,
 * owns the sockets, and runs the ack-timeout — this just decides what the
 * NEXT displayed state should be for a given current state + event, and
 * (separately) whether a stalled "queue-pending" is worth retrying.
 *
 * The one rule every transition here exists to enforce: "searching" — the
 * label StatusPill shows as "Finding someone…" — may ONLY ever be entered
 * via a "queued-received" event, i.e. only after the server has actually
 * confirmed this account is in its matchmaker queue. Sending "find" (or
 * "skip", or resuming after a block) is never enough on its own; see
 * "queue-pending" below for what covers the gap between asking and being
 * confirmed.
 */

export type MatchState = "idle" | "queue-pending" | "searching" | "connecting" | "active" | "peer-left" | "paused"

export type MatchStateEvent =
  /** findMatch() sent "find". */
  | { type: "find-sent" }
  /** skip() sent "skip". */
  | { type: "skip-sent" }
  /** block() sent "block" — the eventual resume (findMatch(), once "blocked" acks) is its own separate "find-sent" event; this is just block()'s own immediate optimistic entry into the same waiting state. */
  | { type: "block-sent" }
  /** The server's "queued" message — the ONLY event that may produce "searching". */
  | { type: "queued-received" }
  /** The server's "matched" message — always wins outright, from any state (including "queue-pending", when the server pairs you before a "queued" ack would even be worth sending). */
  | { type: "matched-received" }
  /** The server's "peer-left" message. */
  | { type: "peer-left-received" }
  /** pauseMatching(). */
  | { type: "paused" }
  /** leaveQueueOnly() — camera off, or any other "leave the real queue without pausing" trigger. */
  | { type: "left-queue" }
  /** Full teardown (realtime disabled) or any other hard reset back to a clean slate. */
  | { type: "reset-idle" }

export function nextMatchState(current: MatchState, event: MatchStateEvent): MatchState {
  switch (event.type) {
    case "find-sent":
    case "skip-sent":
    case "block-sent":
      return "queue-pending"
    case "queued-received":
      // Only promotes an attempt that's actually still current — "idle"/
      // "paused" (the guest backed out before this in-flight ack arrived),
      // "peer-left" (already retrying its own way), "connecting"/"active"
      // (a match has since superseded this search entirely) all leave the
      // state exactly as it was; accepting the ack anyway would resurrect
      // "Finding someone…" over a search the guest already moved on from.
      return current === "queue-pending" || current === "searching" ? "searching" : current
    case "matched-received":
      return "connecting"
    case "peer-left-received":
      return "peer-left"
    case "paused":
      return "paused"
    case "left-queue":
      return current === "searching" || current === "queue-pending" ? "idle" : current
    case "reset-idle":
      return "idle"
  }
}

/**
 * Whether a "queue-pending" that's gone unconfirmed for the ack-timeout
 * window (see useMatchmaking.ts's QUEUE_PENDING_ACK_TIMEOUT_MS, which owns
 * the actual timer) is worth one fresh retry. Pure so the DECISION is
 * testable without real timers; the hook still owns firing it.
 */
export function shouldRetryStalledQueuePending(
  state: MatchState,
  wantsMatching: boolean,
  realtimeReady: boolean
): boolean {
  return state === "queue-pending" && wantsMatching && realtimeReady
}
