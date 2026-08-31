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

// "error" — added specifically so a matchmaking attempt that never gets
// confirmed, even after one retry, has somewhere honest to land instead of
// retrying forever (see decideQueuePendingTimeout below). StatusPill is
// still the one place this ever renders — no separate error surface.
export type MatchState = "idle" | "queue-pending" | "searching" | "connecting" | "active" | "peer-left" | "paused" | "error"

export type MatchStateEvent =
  /** findMatch() sent "find" — a genuinely new/resumed search, never the ack-timeout's own internal retry (see MAX_AUTOMATIC_QUEUE_PENDING_RETRIES/decideQueuePendingTimeout — that retry re-enters "queue-pending" too, but must NOT reset the retry budget the way a real find-sent does; see useMatchmaking.ts's sendFind() vs findMatch()). */
  | { type: "find-sent" }
  /** skip() sent "skip". */
  | { type: "skip-sent" }
  /** block() sent "block" — the eventual resume (findMatch(), once "blocked" acks) is its own separate "find-sent" event; this is just block()'s own immediate optimistic entry into the same waiting state. */
  | { type: "block-sent" }
  /** The server's "queued" message — the ONLY event that may produce "searching". */
  | { type: "queued-received" }
  /** The server's "matched" message — always wins outright, from any state (including "queue-pending"/"error", when the server pairs you before/despite a "queued" ack). */
  | { type: "matched-received" }
  /** The server's "peer-left" message. */
  | { type: "peer-left-received" }
  /** pauseMatching(). */
  | { type: "paused" }
  /** leaveQueueOnly() — camera off, or any other "leave the real queue without pausing" trigger. */
  | { type: "left-queue" }
  /** Full teardown (realtime disabled) or any other hard reset back to a clean slate. */
  | { type: "reset-idle" }
  /** decideQueuePendingTimeout() returned "give-up" — the automatic retry budget is spent and neither "queued" nor "matched" ever arrived. */
  | { type: "queue-pending-exhausted" }

export function nextMatchState(current: MatchState, event: MatchStateEvent): MatchState {
  switch (event.type) {
    case "find-sent":
    case "skip-sent":
    case "block-sent":
      // Unconditional, including from "error" — this is exactly how a
      // guest (or the bounded automatic retry itself) leaves "error"
      // behind: by starting a fresh attempt, not by some separate
      // "dismiss the error" action.
      return "queue-pending"
    case "queued-received":
      // Only promotes an attempt that's actually still current — "idle"/
      // "paused"/"error" (the guest backed out, or the attempt already
      // gave up, before this in-flight ack arrived), "peer-left" (already
      // retrying its own way), "connecting"/"active" (a match has since
      // superseded this search entirely) all leave the state exactly as it
      // was; accepting the ack anyway would resurrect "Finding someone…"
      // over a search the guest already moved on from.
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
    case "queue-pending-exhausted":
      return "error"
  }
}

/** How many times decideQueuePendingTimeout() below allows an unconfirmed "queue-pending" to be automatically retried (via a fresh "find") before giving up — "at most ONE automatic retry per matchmaking attempt". Exported so useMatchmaking.ts's own timer loop and this module's tests both use the exact same number, never two that could quietly drift apart. */
export const MAX_AUTOMATIC_QUEUE_PENDING_RETRIES = 1

export type QueuePendingTimeoutDecision = "retry" | "give-up" | "do-nothing"

/**
 * What to do when a "queue-pending" has gone unconfirmed for the
 * ack-timeout window (useMatchmaking.ts's QUEUE_PENDING_ACK_TIMEOUT_MS,
 * which owns the actual timer) — pure so the DECISION is testable without
 * real timers; the hook still owns firing it and the retry-count ref this
 * reads.
 *
 * - "do-nothing": the guest already backed out (paused) or the connection
 *   already dropped in the meantime — never surface an error, and never
 *   retry, for an attempt that isn't even current anymore.
 * - "retry": still under the automatic-retry budget — send one more fresh
 *   "find" (see useMatchmaking.ts's sendFind(), NOT findMatch() — this
 *   retry must not reset the very counter it's consuming).
 * - "give-up": the budget (MAX_AUTOMATIC_QUEUE_PENDING_RETRIES) is spent —
 *   stop retrying automatically and surface a real error instead
 *   (nextMatchState's "queue-pending-exhausted" event) rather than sending
 *   "find" every QUEUE_PENDING_ACK_TIMEOUT_MS indefinitely.
 */
export function decideQueuePendingTimeout(
  retryCount: number,
  wantsMatching: boolean,
  realtimeReady: boolean
): QueuePendingTimeoutDecision {
  if (!wantsMatching || !realtimeReady) return "do-nothing"
  return retryCount < MAX_AUTOMATIC_QUEUE_PENDING_RETRIES ? "retry" : "give-up"
}
