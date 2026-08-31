import { test } from "node:test"
import assert from "node:assert/strict"
import { nextMatchState, shouldRetryStalledQueuePending } from "../lib/matchStateMachine"
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
  const states: MatchState[] = ["idle", "queue-pending", "searching", "connecting", "active", "peer-left", "paused"]
  for (const state of states) {
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
  const states: MatchState[] = ["idle", "queue-pending", "searching", "connecting", "active", "peer-left", "paused"]
  for (const state of states) {
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

test("shouldRetryStalledQueuePending: only true when actually queue-pending, still wanted, and realtime ready", () => {
  assert.equal(shouldRetryStalledQueuePending("queue-pending", true, true), true)
  assert.equal(shouldRetryStalledQueuePending("searching", true, true), false, "already confirmed — nothing to retry")
  assert.equal(shouldRetryStalledQueuePending("queue-pending", false, true), false, "guest no longer wants matching")
  assert.equal(shouldRetryStalledQueuePending("queue-pending", true, false), false, "not even connected — must not fire behind a dead socket")
  assert.equal(shouldRetryStalledQueuePending("paused", false, false), false)
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
