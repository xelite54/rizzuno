import { test } from "node:test"
import assert from "node:assert/strict"
import { friendsCacheKey, parseFriendsCache } from "../lib/friendsCache.ts"

test("friends cache preserves the list without claiming stale online presence", () => {
  const friend = { id: "f1", userId: "u1", username: "friend", profilePhoto: null, online: true, since: 123 }
  assert.deepEqual(parseFriendsCache(JSON.stringify([friend])), [{ ...friend, online: false }])
  assert.notEqual(friendsCacheKey("account-a"), friendsCacheKey("account-b"))
})

test("friends cache tolerates missing/corrupt data and authoritative empty lists", () => {
  for (const value of [null, "invalid", "{}", "[]", '[null,{},42]']) {
    assert.deepEqual(parseFriendsCache(value), [])
  }
})
