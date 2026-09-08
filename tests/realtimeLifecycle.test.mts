import { test } from "node:test"
import assert from "node:assert/strict"
import {
  canSearch,
  isCurrentRoom,
  resolveRealtimeAccount,
  retainRealtime,
  shouldReconnectAfterClose,
  nextSupersededRetryDelayMs,
  MAX_SUPERSEDED_RETRIES,
  SUPERSEDED_RETRY_DELAY_MS,
} from "../lib/realtimeLifecycle"
import { WS_CLOSE_SUPERSEDED } from "../lib/signaling/protocol"

test("find/reconnect/resume cannot search while a room exists", () => {
  assert.equal(canSearch("existing-room"), false)
  assert.equal(canSearch(null), true)
})
test("peer-left and signals only apply to the intended live room", () => {
  assert.equal(isCurrentRoom("new", "old"), false)
  assert.equal(isCurrentRoom(null, "old"), false)
  assert.equal(isCurrentRoom("new", "new"), true)
})
test("session loading retains authenticated account, never treats loading as signout", () => {
  assert.equal(resolveRealtimeAccount("a", undefined, "loading"), "a")
  assert.equal(resolveRealtimeAccount("a", "a", "loading"), "a")
  assert.equal(resolveRealtimeAccount(undefined, undefined, "loading"), undefined)
  assert.equal(resolveRealtimeAccount("a", undefined, "unauthenticated"), undefined)
  assert.equal(resolveRealtimeAccount("a", "b", "authenticated"), "b")
})
test("profile/legal refresh retains admission only for same account; explicit revocation closes", () => {
  assert.equal(retainRealtime("a", "a", "checking", false, false), true)
  assert.equal(retainRealtime("a", "a", "accepted", false, false), true)
  assert.equal(retainRealtime("a", "a", "required", true, true), false)
  assert.equal(retainRealtime("a", "b", "checking", false, false), false)
  assert.equal(retainRealtime("a", undefined, "accepted", true, true), false)
})
test("a superseded close (lost the same-account ownership race) does not reconnect", () => {
  assert.equal(shouldReconnectAfterClose(WS_CLOSE_SUPERSEDED), false)
})
test("every other close code still reconnects — network drops, unclean disconnects, server restarts, anything else", () => {
  // Standard codes a real network blip / server shutdown / abnormal
  // closure could plausibly produce.
  for (const code of [1000, 1001, 1005, 1006, 1008, 1011, 1012, 1013]) {
    assert.equal(shouldReconnectAfterClose(code), true, `code ${code} must still reconnect`)
  }
  assert.notEqual(WS_CLOSE_SUPERSEDED, 1000, "sanity: the superseded code must not collide with a standard one")
})
test("a superseded socket gets exactly one delayed retry, then gives up for good", () => {
  assert.equal(nextSupersededRetryDelayMs(0), SUPERSEDED_RETRY_DELAY_MS, "the first superseded close still gets one retry")
  assert.equal(nextSupersededRetryDelayMs(MAX_SUPERSEDED_RETRIES), null, "once the bounded budget is spent, no further retry")
  assert.equal(nextSupersededRetryDelayMs(MAX_SUPERSEDED_RETRIES + 5), null, "never resumes retrying past the budget")
})
test("the superseded retry delay is comfortably longer than one full server heartbeat cycle (40s worst case), and far slower than the normal backoff", () => {
  assert.ok(SUPERSEDED_RETRY_DELAY_MS > 40_000, "must outlast the ~40s worst-case heartbeat reap time, or it just retries into the same rejection")
  assert.ok(SUPERSEDED_RETRY_DELAY_MS > 8000, "must never be as fast as the normal network-close backoff (caps at 8s) — that fast cadence is what caused the original reconnect war")
})
