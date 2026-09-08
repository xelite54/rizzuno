import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { resetDbMockState } from "./helpers/dbMock.mts"

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

// Test 13/14 — chat must never depend on WebRTC/video state. The server
// itself has no concept of "connecting"/"active" video at all (that's
// purely client-side, in hooks/useMatchmaking.ts's `state` derivation —
// see its own doc comment) — a room-scoped "chat" is only ever gated on
// real server-side room membership. This proves that architecturally: chat
// succeeds and delivers immediately after "matched", before a single
// WebRTC signal ("signal": offer/answer/ice) has ever been exchanged —
// i.e. chat has zero functional dependency on any WebRTC negotiation ever
// happening, let alone completing. (The corresponding client-side fix —
// MatchStage.tsx's `canChat`, driven by useMatchmaking's `canMatchChat`,
// no longer requiring `state === "active"` — is verified by type-checking
// and code inspection; this repo's test runner has no browser/DOM
// environment to drive an actual CompactChat/MatchChatPanel render.)
test("Test 13/14 — chat succeeds immediately after 'matched', before any WebRTC signal is ever exchanged", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("chat-early-a"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("chat-early-b"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    // No "signal" message of any kind sent by either side — this is what
    // "still connecting" (offer not even sent yet) looks like server-side.
    const clientMessageId = crypto.randomUUID()
    a.send({ type: "chat", roomId: matched.roomId, clientMessageId, content: { kind: "text", text: "hi before video" } })
    const delivered = await b.waitForType("chat")
    assert.deepEqual(delivered.content, { kind: "text", text: "hi before video" })
    const sent = await a.waitForType("chat-sent")
    assert.equal(sent.clientMessageId, clientMessageId)

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 15/16 — a valid send reaches the partner AND the sender gets an
// explicit delivery acknowledgement (see WS_CLOSE_SUPERSEDED's sibling fix
// in lib/signaling/protocol.ts's "chat-sent") — not just a local append
// the sender has to trust blindly.
test("Test 15/16 — a valid room message reaches the partner and the sender gets a delivery acknowledgement", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("valid-a"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("valid-b"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "chat", roomId: matched.roomId, clientMessageId, content: { kind: "text", text: "real message" } })
    const [delivered, sent] = await Promise.all([b.waitForType("chat"), a.waitForType("chat-sent")])
    assert.deepEqual(delivered.content, { kind: "text", text: "real message" })
    assert.equal(delivered.roomId, matched.roomId)
    assert.equal(sent.clientMessageId, clientMessageId)
    assert.equal(sent.roomId, matched.roomId)
    assert.ok(typeof sent.ts === "number")

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 17 — a wrong/stale roomId is rejected explicitly, not silently
// dropped while the sender believes it went through.
test("Test 17 — a wrong/stale roomId is rejected with an explicit chat-failed, never silently dropped", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("stale-a"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("stale-b"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    await a.waitForType("matched")
    await b.waitForType("matched")

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "chat", roomId: "not-a-real-room-id", clientMessageId, content: { kind: "text", text: "wrong room" } })
    const failed = await a.waitForType("chat-failed")
    assert.equal(failed.clientMessageId, clientMessageId)
    assert.equal(failed.reason, "stale_room")
    await assert.rejects(() => b.waitForType("chat", 200), /timed out/)

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 18 — once the partner has left, further sends into that same
// (now-dead) room are rejected, never delivered to a partner who's gone.
test("Test 18 — peer-left prevents further chat delivery into that room", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("left-a"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("left-b"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    b.send({ type: "leave" })
    await a.waitForType("peer-left")

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "chat", roomId: matched.roomId, clientMessageId, content: { kind: "text", text: "are you still there" } })
    const failed = await a.waitForType("chat-failed")
    assert.equal(failed.clientMessageId, clientMessageId)
    assert.equal(failed.reason, "stale_room")

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 20 — a chat sent against a PREVIOUS room's id, after this account
// has already moved into a brand new one, is rejected — never delivered
// as if it belonged to the new room (the server's own roomPartner check —
// derived from this account's LIVE roomId, never the client-supplied one —
// already makes this impossible; this proves it end-to-end). The client's
// own isCurrentRoom() guard against a stale INCOMING message is unit-
// tested directly in tests/realtimeLifecycle.test.mts.
test("Test 20 — a stale roomId from a previous match cannot cross into (or disturb) a newer room", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("cross-a"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("cross-b"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const firstMatch = await a.waitForType("matched")
    await b.waitForType("matched")

    a.send({ type: "skip" })
    await b.waitForType("peer-left")

    const c = await connectAndHello(server.url, uid("cross-c"), { gender: "female" })
    c.send({ type: "find" })
    const secondMatch = await a.waitForType("matched")
    await c.waitForType("matched")
    assert.notEqual(secondMatch.roomId, firstMatch.roomId)

    // Using the FIRST (now-stale) roomId while genuinely in the SECOND room.
    const clientMessageId = crypto.randomUUID()
    a.send({ type: "chat", roomId: firstMatch.roomId, clientMessageId, content: { kind: "text", text: "old room" } })
    const failed = await a.waitForType("chat-failed")
    assert.equal(failed.reason, "stale_room")
    await assert.rejects(() => c.waitForType("chat", 200), /timed out/)

    // The genuinely current room still works normally afterward.
    const goodId = crypto.randomUUID()
    a.send({ type: "chat", roomId: secondMatch.roomId, clientMessageId: goodId, content: { kind: "text", text: "new room" } })
    const delivered = await c.waitForType("chat")
    assert.deepEqual(delivered.content, { kind: "text", text: "new room" })

    a.close()
    b.close()
    c.close()
  } finally {
    await server.close()
  }
})
