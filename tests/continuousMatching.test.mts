import { test } from "node:test"
import assert from "node:assert/strict"
import { canResumeMatching, MATCH_RETRY_COOLDOWN_MS, nextMatchState } from "../lib/matchStateMachine"
import { playbackHasStalled } from "../lib/peerPlayback"

test("repeated exhausted retry bursts can recover until the user stops", () => {
  assert.equal(MATCH_RETRY_COOLDOWN_MS, 15_000)
  for (let attempt = 0; attempt < 100; attempt++) {
    const cooldown = nextMatchState("queue-pending", { type: "queue-pending-exhausted" })
    assert.equal(canResumeMatching(true, true, true, false), true)
    assert.equal(nextMatchState(cooldown, { type: "find-sent" }), "queue-pending")
  }
  assert.equal(canResumeMatching(false, true, true, false), false)
})

test("camera restoration never restarts a stopped search; leaving and restrictions prevent retries", () => {
  assert.equal(canResumeMatching(true, true, false, false), false)
  assert.equal(canResumeMatching(false, true, true, false), false)
  assert.equal(canResumeMatching(true, false, true, false), false)
  assert.equal(canResumeMatching(true, true, true, true), false)
})

test("short playback hiccups and background rendering suspension are not failed calls", () => {
  assert.equal(playbackHasStalled(true, 1001, 1000), false)
  assert.equal(playbackHasStalled(true, 6000, 1000), false)
  assert.equal(playbackHasStalled(true, 6001, 1000), true)
  assert.equal(playbackHasStalled(false, 100_000, 1000), false)
  assert.equal(playbackHasStalled(true, 100_001, 100_000), false)
})
