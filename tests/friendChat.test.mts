import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { dbMockState, resetDbMockState } from "./helpers/dbMock.mts"

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

/** Seeds a friendship directly in the mock db — the same shortcut `blockedPairs`/`genders` already use, bypassing a full sendFriendRequest/accept flow the mock doesn't model realistically (see dbMock.mts's own doc comment on `friendships`). */
function makeFriendship(a: string, b: string): string {
  const id = `friendship-${a}-${b}`
  dbMockState.friendships.set(id, [a, b])
  return id
}

// Test 1/2 — a confirmed friend's send is persisted AND, since the
// recipient is online, delivered live immediately.
test("Test 1/2 — a confirmed friend's message is persisted and delivered live to an online recipient", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    const a = await connectAndHello(server.url, alice, { gender: "male" })
    const b = await connectAndHello(server.url, bob, { gender: "female" })

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId, text: "hey bob" })

    const [sent, delivered] = await Promise.all([a.waitForType("friend-chat-sent"), b.waitForType("friend-chat-message")])
    assert.equal(sent.clientMessageId, clientMessageId)
    assert.equal(sent.friendshipId, friendshipId)
    assert.ok(sent.messageId)
    assert.equal(delivered.friendshipId, friendshipId)
    assert.equal(delivered.message.text, "hey bob")
    assert.equal(delivered.message.id, sent.messageId)

    // Test 1: actually saved (see lib/db.ts's sendFriendMessage — the real
    // implementation this mock stands in for) — verified here via the
    // mock's own persisted store, the same store listFriendMessages/
    // markFriendMessagesRead/countUnreadFriendMessages all read from below.
    assert.equal(dbMockState.friendMessages.length, 1)
    assert.equal(dbMockState.friendMessages[0].text, "hey bob")
    assert.equal(dbMockState.friendMessages[0].senderId, alice)
    assert.equal(dbMockState.friendMessages[0].recipientId, bob)

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 3 — the recipient never connects during this send at all; the send
// must still succeed (ack the sender) and persist, not fail just because
// nobody was there to receive it live.
test("Test 3 — an offline recipient does not stop the message from being sent and persisted", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    const a = await connectAndHello(server.url, alice, { gender: "male" })

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId, text: "are you there" })
    const sent = await a.waitForType("friend-chat-sent")
    assert.equal(sent.clientMessageId, clientMessageId)
    assert.equal(dbMockState.friendMessages.length, 1)
    assert.equal(dbMockState.friendMessages[0].readAt, null)

    a.close()
  } finally {
    await server.close()
  }
})

// Test 6 — a non-friend (no friendship row at all) cannot send.
test("Test 6 — a non-friend cannot send a friend-chat message", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const stranger = uid("stranger")
    const a = await connectAndHello(server.url, alice, { gender: "male" })

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId: "not-a-real-friendship", clientMessageId, text: "hi" })
    const failed = await a.waitForType("friend-chat-error")
    assert.equal(failed.clientMessageId, clientMessageId)
    assert.equal(failed.reason, "not_friends")
    assert.equal(dbMockState.friendMessages.length, 0)

    a.close()
    void stranger
  } finally {
    await server.close()
  }
})

// Test 8 — unfriending removes the friendship row; a send that follows
// must be rejected the same way a non-friend's would be.
test("Test 8 — unfriending prevents future sends", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    const a = await connectAndHello(server.url, alice, { gender: "male" })

    // A send while still friends works normally.
    const firstId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId: firstId, text: "still friends" })
    assert.equal((await a.waitForType("friend-chat-sent")).clientMessageId, firstId)

    // Unfriend — removes the row exactly the way removeFriendship() does.
    dbMockState.friendships.delete(friendshipId)

    const secondId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId: secondId, text: "are we still friends" })
    const failed = await a.waitForType("friend-chat-error")
    assert.equal(failed.clientMessageId, secondId)
    assert.equal(failed.reason, "not_friends")
    assert.equal(dbMockState.friendMessages.length, 1, "only the first, pre-unfriend message was ever persisted")

    a.close()
  } finally {
    await server.close()
  }
})

// Test 9 — a block (either direction) prevents future sends between the
// two accounts, even though the friendship row itself may still exist.
test("Test 9 — a block prevents future sends", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    dbMockState.blockedPairs.add([alice, bob].sort().join("|"))
    const a = await connectAndHello(server.url, alice, { gender: "male" })

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId, text: "hello?" })
    const failed = await a.waitForType("friend-chat-error")
    assert.equal(failed.clientMessageId, clientMessageId)
    assert.equal(failed.reason, "blocked")
    assert.equal(dbMockState.friendMessages.length, 0)

    a.close()
  } finally {
    await server.close()
  }
})

// Test 10 — retrying the exact same clientMessageId (a network retry, or a
// duplicate WS send) must never create a second row, and must never
// re-deliver a second live copy to the recipient.
test("Test 10 — a duplicate clientMessageId does not create a duplicate message or a duplicate live delivery", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    const a = await connectAndHello(server.url, alice, { gender: "male" })
    const b = await connectAndHello(server.url, bob, { gender: "female" })

    const clientMessageId = crypto.randomUUID()
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId, text: "only once" })
    const firstSent = await a.waitForType("friend-chat-sent")
    await b.waitForType("friend-chat-message")

    // Retry — same clientMessageId, same text.
    a.send({ type: "friend-chat-send", friendshipId, clientMessageId, text: "only once" })
    const secondSent = await a.waitForType("friend-chat-sent")
    assert.equal(secondSent.messageId, firstSent.messageId, "the retry resolves to the SAME persisted message")

    // No second live push — race a short timeout against one arriving.
    await assert.rejects(() => b.waitForType("friend-chat-message", 200), /timed out/)
    assert.equal(dbMockState.friendMessages.length, 1, "still exactly one row, not two")

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 11/12 — unread counts increment for real messages, and opening
// (marking read) zeroes them back out via a fresh friends-snapshot — the
// same mechanism a refresh/relogin reads from, not a client-local counter.
test("Test 11/12 — unread count increments on delivery and clears on friend-chat-read", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const alice = uid("alice")
    const bob = uid("bob")
    const friendshipId = makeFriendship(alice, bob)
    const a = await connectAndHello(server.url, alice, { gender: "male" })
    const b = await connectAndHello(server.url, bob, { gender: "female" })

    // Bob's baseline snapshot (from hello) starts at 0.
    const baseline = await b.waitForType("friends-snapshot")
    assert.equal(baseline.friends.find((f) => f.id === friendshipId)?.unreadCount ?? 0, 0)

    a.send({ type: "friend-chat-send", friendshipId, clientMessageId: crypto.randomUUID(), text: "one" })
    await a.waitForType("friend-chat-sent")
    await b.waitForType("friend-chat-message")
    // Delivery triggers a fresh snapshot to the (online) recipient — see
    // server/ws-server.ts's "friend-chat-send" handler.
    const afterOne = await b.waitForType("friends-snapshot")
    assert.equal(afterOne.friends.find((f) => f.id === friendshipId)?.unreadCount, 1)

    a.send({ type: "friend-chat-send", friendshipId, clientMessageId: crypto.randomUUID(), text: "two" })
    await b.waitForType("friend-chat-message")
    const afterTwo = await b.waitForType("friends-snapshot")
    assert.equal(afterTwo.friends.find((f) => f.id === friendshipId)?.unreadCount, 2)

    // Test 12: opening the conversation marks received messages read.
    b.send({ type: "friend-chat-read", friendshipId })
    const afterRead = await b.waitForType("friends-snapshot")
    assert.equal(afterRead.friends.find((f) => f.id === friendshipId)?.unreadCount, 0)
    assert.ok(dbMockState.friendMessages.every((m) => m.recipientId !== bob || m.readAt !== null))

    a.close()
    b.close()
  } finally {
    await server.close()
  }
})
