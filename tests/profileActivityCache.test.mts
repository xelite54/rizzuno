import { test } from "node:test"
import assert from "node:assert/strict"
import { blockedUsersKey, matchHistoryKey, MAX_MATCH_HISTORY, parseBlockedUsers, parseMatchHistory, rememberMatch } from "../lib/profileActivityCache"
import type { PublicPeerIdentity } from "../lib/signaling/protocol"

const peer = { displayId: "peer-1", handle: "Maple", username: "alex", gender: "male" as const, profilePhoto: null, countryCode: "US" }

test("history survives a storage round trip, including a match still in progress", () => {
  const saved = JSON.stringify(rememberMatch([], peer))
  assert.deepEqual(parseMatchHistory(saved), [peer])
  const restored = parseMatchHistory(saved)
  assert.deepEqual(rememberMatch(restored, { ...peer, username: "updated" }), [{ ...peer, username: "updated" }])
})

test("history keeps the newest 50 profiles after repeated matches and refreshes", () => {
  let history: PublicPeerIdentity[] = []
  for (let index = 0; index < 60; index++) {
    history = rememberMatch(history, { ...peer, displayId: `peer-${index}` })
  }
  const restored = parseMatchHistory(JSON.stringify(history))
  assert.equal(restored.length, MAX_MATCH_HISTORY)
  assert.equal(restored[0].displayId, "peer-59")
  assert.equal(restored.at(-1)?.displayId, "peer-10")
})

test("blocks restore with nullable names; an authoritative empty snapshot removes old entries", () => {
  const blocked = [{ userId: "blocked-1", username: null }, { userId: "blocked-2", username: "alex" }]
  assert.deepEqual(parseBlockedUsers(JSON.stringify(blocked)), blocked)
  assert.deepEqual(parseBlockedUsers(JSON.stringify([])), [])
})

test("cache keys separate accounts and history from blocks", () => {
  const keys = new Set([matchHistoryKey("a"), matchHistoryKey("b"), blockedUsersKey("a"), blockedUsersKey("b")])
  assert.equal(keys.size, 4)
})

test("missing or malformed storage never breaks profile lists", () => {
  for (const raw of [null, "bad json", "{}", '[null,42,{},"text"]']) {
    assert.deepEqual(parseMatchHistory(raw), [])
    assert.deepEqual(parseBlockedUsers(raw), [])
  }
  assert.deepEqual(parseMatchHistory(JSON.stringify([{ ...peer, userId: "private-id", gender: 42 }])), [{
    displayId: peer.displayId, handle: peer.handle, username: peer.username, profilePhoto: null, countryCode: "US",
  }])
})
