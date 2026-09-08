import { test } from "node:test"
import assert from "node:assert/strict"
import { canSearch, isCurrentRoom, resolveRealtimeAccount, retainRealtime } from "../lib/realtimeLifecycle"

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
