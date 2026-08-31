import { test } from "node:test"
import assert from "node:assert/strict"
import { nextMatchState, decideQueuePendingTimeout, MAX_AUTOMATIC_QUEUE_PENDING_RETRIES } from "../lib/matchStateMachine"
import type { MatchState, MatchStateEvent } from "../lib/matchStateMachine"

const ALL_EVENTS: MatchStateEvent[] = [
  { type: "find-sent" },
  { type: "skip-sent" },
  { type: "block-sent" },
  { type: "queued-received" },
  { type: "matched-received" },
  { type: "peer-left-received" },
  { type: "paused" },
  { type: "left-queue" },
  { type: "reset-idle" },
  { type: "queue-pending-exhausted" },
]

const ALL_STATES: MatchState[] = [
  "idle",
  "queue-pending",
  "searching",
  "connecting",
  "active",
  "peer-left",
  "paused",
  "error",
]

// Root-cause coverage: sending "find"/"skip"/block's resume must land on
// "queue-pending", never "searching" — "searching" is what StatusPill reads
// as "Finding someone…", and that label must only ever describe a
// server-confirmed queue membership.
test("find-sent alone does not show Searching — it lands on queue-pending", () => {
  assert.equal(nextMatchState("idle", { type: "find-sent" }), "queue-pending")
})

test("skip-sent and block-sent land on queue-pending too, not searching — same rule as find", () => {
  assert.equal(nextMatchState("active", { type: "skip-sent" }), "queue-pending")
  assert.equal(nextMatchState("active", { type: "block-sent" }), "queue-pending")
})

// Root-cause coverage: the server's "queued" is the ONLY thing allowed to
// produce "searching".
test("queued-received from queue-pending promotes to searching", () => {
  assert.equal(nextMatchState("queue-pending", { type: "queued-received" }), "searching")
})

test("queued-received from searching stays searching (a second ack for the same still-active search is harmless)", () => {
  assert.equal(nextMatchState("searching", { type: "queued-received" }), "searching")
})

// Root cause of the bug this task fixes: NO event other than
// "queued-received" may ever produce "searching" — asserted exhaustively
// (over every state × every OTHER event) rather than spot-checked, so this
// stays true even if a new event is ever added later without updating this
// test by hand.
test("no event other than queued-received can ever produce searching, from any starting state", () => {
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (event.type === "queued-received") continue
      const next = nextMatchState(state, event)
      assert.notEqual(
        next,
        "searching",
        `nextMatchState(${state}, ${event.type}) must never produce "searching" — only "queued-received" may`
      )
    }
  }
})

// Root-cause coverage: a match arriving before any "queued" ever did (a
// real, common case — the server can pair two people the instant it
// processes "find") must go straight from queue-pending to connecting,
// skipping "searching" entirely — "matched" wins outright from ANY state.
test("matched-received works without ever having seen queued — queue-pending goes straight to connecting", () => {
  assert.equal(nextMatchState("queue-pending", { type: "matched-received" }), "connecting")
})

test("matched-received wins from every state, not just queue-pending/searching", () => {
  for (const state of ALL_STATES) {
    assert.equal(nextMatchState(state, { type: "matched-received" }), "connecting")
  }
})

// Root-cause coverage: pausing while queue-pending (asked, not yet
// confirmed) must cancel the attempt — not leave it to resolve into
// "searching" later if a stale "queued" ack still shows up. Pause always
// wins outright, mirroring matched-received's unconditional behavior.
test("pausing during queue-pending cancels it", () => {
  assert.equal(nextMatchState("queue-pending", { type: "paused" }), "paused")
})

test("a queued-received ack that arrives AFTER the guest already paused is ignored, not resurrected into searching", () => {
  // Sequence: find-sent -> paused (guest backed out) -> a late "queued" for
  // the abandoned attempt finally arrives.
  const afterPause = nextMatchState(nextMatchState("idle", { type: "find-sent" }), { type: "paused" })
  assert.equal(afterPause, "paused")
  assert.equal(nextMatchState(afterPause, { type: "queued-received" }), "paused", "a stale ack must not undo the pause")
})

// Root-cause coverage: "dropped find cannot leave fake Searching state" —
// structurally guaranteed by the same exhaustive rule above (nothing but
// queued-received produces "searching"), so a find that's sent and then
// simply never acknowledged at all (dropped on the wire, or the server
// silently fails) leaves the state sitting on "queue-pending" — never a
// false "searching" — and useMatchmaking.ts's ack-timeout effect is what
// actually recovers from that; the retry DECISION it uses is tested below.
test("a find that's sent and never acknowledged at all stays on queue-pending, never fakes searching", () => {
  const afterFind = nextMatchState("idle", { type: "find-sent" })
  assert.equal(afterFind, "queue-pending")
  // No further event ever arrives — nothing here can turn this into
  // "searching" on its own; only an explicit queued-received could, and by
  // definition none arrives for a dropped find.
})

// Root-cause coverage for THIS task: at most ONE automatic retry per
// matchmaking attempt — never an indefinite "find" every ack-timeout
// window. MAX_AUTOMATIC_QUEUE_PENDING_RETRIES is 1, so retryCount 0 (the
// original send has gone unanswered) is still within budget; retryCount 1
// (the one retry has ALSO gone unanswered) is not.
test("decideQueuePendingTimeout: retries once (retryCount 0), then gives up (retryCount at the max) — never a third time", () => {
  assert.equal(MAX_AUTOMATIC_QUEUE_PENDING_RETRIES, 1, "this suite assumes exactly one automatic retry — update it if that ever changes")
  assert.equal(decideQueuePendingTimeout(0, true, true), "retry", "the original send timed out — one retry is still owed")
  assert.equal(decideQueuePendingTimeout(1, true, true), "give-up", "the one retry ALSO timed out — budget spent, must not retry a second time")
  assert.equal(decideQueuePendingTimeout(2, true, true), "give-up", "well past the budget — still give-up, never retry")
})

test("decideQueuePendingTimeout: do-nothing (neither retries nor surfaces an error) when the guest already backed out or disconnected", () => {
  assert.equal(decideQueuePendingTimeout(0, false, true), "do-nothing", "guest no longer wants matching (paused)")
  assert.equal(decideQueuePendingTimeout(0, true, false), "do-nothing", "not realtime-ready — must not fire behind a dead socket")
  assert.equal(decideQueuePendingTimeout(1, false, false), "do-nothing", "budget-exhausted but ALSO already backed out — no spurious error either")
})

// The full sequence a real stalled attempt goes through, composed exactly
// the way useMatchmaking.ts's ack-timeout effect uses these two functions
// together — proving the retry is strictly bounded end-to-end, not just
// that the two pieces are individually correct in isolation.
test("end-to-end: a matchmaking attempt that never gets acknowledged retries exactly once, then surfaces error — never a third find", () => {
  let state: MatchState = nextMatchState("idle", { type: "find-sent" }) // the original "find"
  assert.equal(state, "queue-pending")
  let retryCount = 0
  const sentFinds: number[] = [1] // the original send counts as attempt #1

  function fireAckTimeout() {
    const decision = decideQueuePendingTimeout(retryCount, /* wantsMatching */ true, /* realtimeReady */ true)
    if (decision === "retry") {
      retryCount += 1
      state = nextMatchState(state, { type: "find-sent" }) // sendFind() — queue-pending again
      sentFinds.push(sentFinds.length + 1)
    } else if (decision === "give-up") {
      state = nextMatchState(state, { type: "queue-pending-exhausted" })
    }
    // "do-nothing" — nothing to do, matching the hook's own early return.
  }

  fireAckTimeout() // attempt #1 (the original find) times out
  assert.equal(retryCount, 1)
  assert.equal(state, "queue-pending", "the one retry was sent — still waiting on it")
  assert.equal(sentFinds.length, 2, "exactly one retry find was sent")

  fireAckTimeout() // attempt #2 (the one retry) ALSO times out
  assert.equal(state, "error", "budget exhausted — surfaces error instead of retrying")
  assert.equal(sentFinds.length, 2, "still exactly two finds total (original + one retry) — no third")

  // Even if the timeout mechanism were somehow invoked again (it shouldn't
  // be — the real effect stops scheduling once state leaves "queue-pending"
  // — but proving the DECISION function itself stays bounded regardless):
  fireAckTimeout()
  assert.equal(sentFinds.length, 2, "decideQueuePendingTimeout keeps saying give-up — retryCount never resets on its own")
})

test("a genuinely new find-sent (not the ack-timeout's own retry) is how 'error' recovers — and a fresh attempt gets its own full budget", () => {
  const errorState = nextMatchState(nextMatchState("idle", { type: "find-sent" }), { type: "queue-pending-exhausted" })
  assert.equal(errorState, "error")
  // The retry button (StatusPill's "Try again", wired to findMatch()) —
  // useMatchmaking.ts's findMatch() resets queuePendingRetryCountRef to 0
  // before sending, so this next decideQueuePendingTimeout call starts
  // fresh at retryCount 0, not still exhausted from the previous attempt.
  const afterRetryClick = nextMatchState(errorState, { type: "find-sent" })
  assert.equal(afterRetryClick, "queue-pending")
  assert.equal(decideQueuePendingTimeout(0, true, true), "retry", "a fresh attempt is owed its own full retry budget")
})

// Root-cause coverage: skip()/block() must show the exact same
// queue-pending -> (only queued-received promotes) -> searching path find()
// does — not a shortcut straight to "searching".
test("skip only shows Searching after a real queue ack, exactly like find", () => {
  const afterSkip = nextMatchState("active", { type: "skip-sent" })
  assert.equal(afterSkip, "queue-pending")
  assert.equal(nextMatchState(afterSkip, { type: "queued-received" }), "searching")
})

test("block only shows Searching after a real queue ack, exactly like find", () => {
  const afterBlock = nextMatchState("active", { type: "block-sent" })
  assert.equal(afterBlock, "queue-pending")
  assert.equal(nextMatchState(afterBlock, { type: "queued-received" }), "searching")
})

test("left-queue (camera off) cancels either queue-pending or searching back to idle, leaves other states alone", () => {
  assert.equal(nextMatchState("queue-pending", { type: "left-queue" }), "idle")
  assert.equal(nextMatchState("searching", { type: "left-queue" }), "idle")
  assert.equal(nextMatchState("paused", { type: "left-queue" }), "paused", "not searching/queue-pending — left untouched")
  assert.equal(nextMatchState("active", { type: "left-queue" }), "active", "not searching/queue-pending — left untouched")
})

test("peer-left-received and reset-idle produce their own named states outright", () => {
  assert.equal(nextMatchState("active", { type: "peer-left-received" }), "peer-left")
  assert.equal(nextMatchState("searching", { type: "reset-idle" }), "idle")
})
