import { test } from "node:test"
import assert from "node:assert/strict"
import { deriveRelationship, type RelationshipInput } from "../lib/profileRelationship.ts"

const base: RelationshipInput = { username: "alex", friends: [], incoming: [], sentUsernames: new Set() }

test("friends win, with their friendship id and presence", () => {
  const r = deriveRelationship({ ...base, username: "Alex", friends: [{ id: "fs1", username: "alex", online: true }], incoming: [{ id: "r1", username: "alex" }] })
  assert.deepEqual(r, { kind: "friend", friendshipId: "fs1", online: true })
})

test("an incoming request shows Accept/Decline", () => {
  assert.deepEqual(deriveRelationship({ ...base, incoming: [{ id: "r1", username: "ALEX" }] }), { kind: "incoming", requestId: "r1" })
})

test("sent requests from the snapshot, optimistic sends, match actions or search flags read as Requested", () => {
  assert.equal(deriveRelationship({ ...base, sentUsernames: new Set(["alex"]) }).kind, "requested")
  assert.equal(deriveRelationship({ ...base, displayId: "d1", displayIdAction: "requested" }).kind, "requested")
  assert.equal(deriveRelationship({ ...base, hint: { alreadyRequested: true } }).kind, "requested")
})

test("friendship known only from a hint or match action has no remove handle", () => {
  assert.deepEqual(deriveRelationship({ ...base, hint: { alreadyFriends: true } }), { kind: "friend", friendshipId: null, online: false })
  assert.deepEqual(deriveRelationship({ ...base, displayIdAction: "friends" }), { kind: "friend", friendshipId: null, online: false })
})

test("otherwise a stranger (Add friend); a failed match request is retryable", () => {
  assert.equal(deriveRelationship(base).kind, "stranger")
  assert.equal(deriveRelationship({ ...base, displayIdAction: "failed" }).kind, "stranger")
  assert.equal(deriveRelationship({ ...base, username: null }).kind, "stranger")
})
