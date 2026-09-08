import { test } from "node:test"
import assert from "node:assert/strict"
import { canSearch, isCurrentRoom, resolveRealtimeAccount, retainRealtime, shouldReconnectAfterClose } from "../lib/realtimeLifecycle"
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
