import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { dbMockState, resetDbMockState } from "./helpers/dbMock.mts"

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
    a.send({ type: "chat", roomId: am.roomId, content: { kind: "text", text: "hello friend" } })
    assert.deepEqual((await b.waitForType("chat")).content, { kind: "text", text: "hello friend" })
    b.send({ type: "leave" })
    await a.waitForType("peer-left")
    a.close(); b.close()
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
