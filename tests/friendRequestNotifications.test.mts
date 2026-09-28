import { test } from "node:test"
import assert from "node:assert/strict"
import { diffNotifiedFriendRequests, takeUnnotifiedFriendRequests } from "../lib/friendRequestNotifications.ts"

test("only never-notified requests are fresh; stored set is pruned to pending", () => {
  const { fresh, nextNotified } = diffNotifiedFriendRequests(new Set(["a", "gone"]), ["a", "b", "c"])
  assert.deepEqual(fresh, ["b", "c"])
  assert.deepEqual(nextNotified, ["a", "b", "c"])
})

test("each request is returned once, across repeated snapshots", () => {
  const account = `test-${Math.random()}`
  assert.deepEqual(takeUnnotifiedFriendRequests(account, ["a", "b", "c"]), ["a", "b", "c"])
  assert.deepEqual(takeUnnotifiedFriendRequests(account, ["a", "b", "c"]), [])
  assert.deepEqual(takeUnnotifiedFriendRequests(account, ["a", "b", "c", "d"]), ["d"])
})
