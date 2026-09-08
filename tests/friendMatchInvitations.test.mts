import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { dbMockState, resetDbMockState } from "./helpers/dbMock.mts"
import { mintTicket } from "../lib/realtimeTicket"

test("friend invitations require recipient consent, then create a direct call with working signaling", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "invite-a", { gender: "male" })
    const b = await connectAndHello(server.url, "invite-b", { gender: "male" })
    a.send({ type: "match-invite", targetUserId: "invite-b" })
    const incoming = await b.waitForType("match-invitations")
    const invite = incoming.invitations[0]
    assert.equal(invite.direction, "incoming")
    assert.equal(invite.userId, "invite-a")
    assert.equal((await a.waitForType("match-invitations")).invitations[0].direction, "outgoing")
    await assert.rejects(() => a.waitForType("matched", 100), /timed out/)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const am = await a.waitForType("matched")
    const bm = await b.waitForType("matched")
    assert.equal(am.roomId, bm.roomId)
    assert.equal(am.initiator, true)
    assert.equal(bm.initiator, false)
    assert.equal(am.alreadyFriends, true)
    a.send({ type: "signal", roomId: am.roomId, data: { kind: "offer", sdp: "test-offer", negotiationId: "n1" } })
    assert.deepEqual((await b.waitForType("signal")).data, { kind: "offer", sdp: "test-offer", negotiationId: "n1" })
    b.send({ type: "signal", roomId: bm.roomId, data: { kind: "answer", sdp: "test-answer", negotiationId: "n1" } })
    assert.deepEqual((await a.waitForType("signal")).data, { kind: "answer", sdp: "test-answer", negotiationId: "n1" })
    a.send({ type: "chat", roomId: am.roomId, clientMessageId: crypto.randomUUID(), content: { kind: "text", text: "hello friend" } })
    assert.deepEqual((await b.waitForType("chat")).content, { kind: "text", text: "hello friend" })
    b.send({ type: "leave" })
    await a.waitForType("peer-left")
    a.close(); b.close()
  } finally { await server.close() }
})

test("a fresh hello preserves the invitation and accepts it on the current connection", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "refresh-a", { gender: "male" })
    const b = await connectAndHello(server.url, "refresh-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "refresh-b" })
    const old = (await b.waitForType("match-invitations")).invitations[0]
    a.send({ type: "hello", ticket: mintTicket("refresh-a"), handle: "refreshed", gender: "male" })
    await a.waitForType("ready")
    b.send({ type: "match-invite-respond", invitationId: old.id, accept: true })
    assert.equal((await a.waitForType("matched")).roomId, (await b.waitForType("matched")).roomId)
    a.close(); b.close()
  } finally { await server.close() }
})

test("sender leaving during the acceptance lookup cannot commit a friend call", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "race-a", { gender: "male" })
    const b = await connectAndHello(server.url, "race-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "race-b" })
    const invite = (await b.waitForType("match-invitations")).invitations[0]
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    dbMockState.areFriendsImpl = async () => { started(); await new Promise<void>((resolve) => { release = resolve }); return true }
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await entered
    a.send({ type: "leave" })
    await b.waitFor((message) => message.type === "match-invitations" && message.invitations.length === 0)
    release()
    await b.waitForType("match-invite-error")
    await assert.rejects(() => a.waitForType("matched", 100), /timed out/)
    a.close(); b.close()
  } finally { await server.close() }
})

test("a friend invitation survives sender socket loss and is accepted after reconnect", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "restore-a", { gender: "male" })
    const b = await connectAndHello(server.url, "restore-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "restore-b" })
    const invite = (await b.waitForType("match-invitations")).invitations[0]
    a.close()
    await new Promise<void>((resolve) => a.ws.once("close", () => resolve()))
    await assert.rejects(() => b.waitForType("match-invitations", 100), /timed out/)
    const replacement = await connectAndHello(server.url, "restore-a", { gender: "male" })
    assert.equal((await replacement.waitForType("match-invitations")).invitations[0].id, invite.id)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const matched = await replacement.waitForType("matched")
    assert.equal((await b.waitForType("matched")).roomId, matched.roomId)
    replacement.send({ type: "find" })
    await assert.rejects(() => b.waitForType("peer-left", 100), /timed out/)
    replacement.send({ type: "chat", roomId: matched.roomId, clientMessageId: crypto.randomUUID(), content: { kind: "text", text: "still here" } })
    assert.deepEqual((await b.waitForType("chat")).content, { kind: "text", text: "still here" })
    replacement.close(); b.close()
  } finally { await server.close() }
})

test("non-friends and blocked friends cannot send match invitations", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "restricted-a", { gender: "male" })
    const b = await connectAndHello(server.url, "restricted-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "restricted-b" })
    await a.waitForType("match-invite-error")
    dbMockState.areFriendsImpl = async () => true
    dbMockState.blockedPairs.add("restricted-a|restricted-b")
    a.send({ type: "match-invite", targetUserId: "restricted-b" })
    await a.waitForType("match-invite-error")
    await assert.rejects(() => b.waitForType("match-invitations", 100), /timed out/)
    a.close(); b.close()
  } finally { await server.close() }
})

test("only the recipient can accept; declining consumes the invitation", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "decline-a", { gender: "male" })
    const b = await connectAndHello(server.url, "decline-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "decline-b" })
    const invite = (await b.waitForType("match-invitations")).invitations[0]
    a.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await a.waitForType("match-invite-error")
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: false })
    assert.deepEqual((await b.waitForType("match-invitations")).invitations, [])
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await b.waitForType("match-invite-error")
    await assert.rejects(() => a.waitForType("matched", 100), /timed out/)
    a.close(); b.close()
  } finally { await server.close() }
})

test("leaving cancels invitations and prevents a late acceptance", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "leave-a", { gender: "male" })
    const b = await connectAndHello(server.url, "leave-b", { gender: "female" })
    a.send({ type: "match-invite", targetUserId: "leave-b" })
    const invite = (await b.waitForType("match-invitations")).invitations[0]
    a.send({ type: "leave" })
    assert.deepEqual((await b.waitForType("match-invitations")).invitations, [])
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await b.waitForType("match-invite-error")
    await assert.rejects(() => a.waitForType("matched", 100), /timed out/)
    a.close(); b.close()
  } finally { await server.close() }
})
