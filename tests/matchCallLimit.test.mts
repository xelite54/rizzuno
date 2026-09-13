import { test } from "node:test"
import assert from "node:assert/strict"
import { MATCH_CALL_LIMIT_MS, matchCallCountdown } from "../lib/matchCallLimit"

test("each match receives thirty minutes and only the final ten seconds show a countdown", () => {
  assert.equal(MATCH_CALL_LIMIT_MS, 1_800_000)
  const expiresAt = 1000 + MATCH_CALL_LIMIT_MS
  assert.equal(matchCallCountdown(expiresAt, 1000), null)
  assert.equal(matchCallCountdown(expiresAt, expiresAt - 10_001), null)
  for (let seconds = 10; seconds >= 1; seconds--) {
    assert.equal(matchCallCountdown(expiresAt, expiresAt - seconds * 1000), seconds)
  }
  assert.equal(matchCallCountdown(expiresAt, expiresAt - 1), 1)
  assert.equal(matchCallCountdown(expiresAt, expiresAt), 0)
  assert.equal(matchCallCountdown(expiresAt, expiresAt + 5000), 0)
  // A new match's deadline restores the full budget instead of retaining zero.
  assert.equal(matchCallCountdown(expiresAt + MATCH_CALL_LIMIT_MS, expiresAt), null)
})
