// Real, protocol-level coverage for the room-establishment handshake (see
// server/ws-server.ts's own doc comment on its RoomSetup type for the full
// design) — "matched" alone never used to prove either browser would
// actually go on to build a working RTCPeerConnection, which is the exact
// production bug this whole mechanism closes: a stale/backgrounded
// inviter's tab could receive "matched" and never get any further, leaving
// its friend's UI stuck on "Connecting" forever with no offer ever coming.
//
// The client half of this (useMatchmaking.ts deciding WHEN to send
// "rtc-ready", useWebRTC.ts only starting negotiation after "rtc-start")
// needs a real browser to exercise and isn't covered here — this file
// drives the server's own side of the handshake directly, exactly the way
// tests/friendMatchInvitations.test.mts and tests/ws-server.test.mts
// already do for the rest of this connection's lifecycle. The one pure,
// client-side piece of logic this whole fix depends on — that a friend
// call's failure/peer-left maps to "reset-idle" (straight to idle), never
// "peer-left-received" (which auto-resumes random searching) — is a plain
// function of lib/matchStateMachine.ts, already exhaustively covered by
// tests/matchStateMachine.test.mts's own ALL_STATES x ALL_EVENTS matrix.
import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello, TestClient } from "./helpers/wsHarness.mts"
import { dbMockState, resetDbMockState } from "./helpers/dbMock.mts"
import { roomSetupTestConfig } from "../server/ws-server"

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

// Every test that shortens this restores it in a `finally` — a leaked
// short deadline would make some OTHER, unrelated test's normal
// (un-rtc-ready'd) "matched" room spontaneously abort mid-test if it
// happened to still be open past a few milliseconds.
const DEFAULT_DEADLINE_MS = roomSetupTestConfig.deadlineMs

/**
 * Sends a match-invite from `sender`'s client to `recipientId` and waits
 * for the recipient's own invitation push — shared setup for every test
 * below that needs a pending invitation to accept. Specifically waits for
 * a NON-EMPTY invitations list, not just any "match-invitations" message —
 * accepting (or declining) a PREVIOUS invite also pushes a fresh (now
 * empty) snapshot, which a test that invites more than once (the soak test
 * in particular) would otherwise pick up first, out of order, from
 * TestClient's own buffered-message replay.
 */
async function inviteAndAwait(sender: TestClient, recipientId: string, recipient: TestClient) {
  sender.send({ type: "match-invite", targetUserId: recipientId })
  const message = await recipient.waitFor((m) => m.type === "match-invitations" && m.invitations.length > 0)
  if (message.type !== "match-invitations") throw new Error("unreachable — predicate only matches match-invitations")
  return message.invitations[0]
}

test("direct call: matched carries source \"friend\", both rtc-ready produces exactly one rtc-start to the initiator, and the initial offer/answer relay normally", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("hs-a")
    const bId = uid("hs-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })

    const am = await a.waitForType("matched")
    const bm = await b.waitForType("matched")
    assert.equal(am.roomId, bm.roomId, "both sides land in the same room")
    assert.equal(am.source, "friend")
    assert.equal(bm.source, "friend")
    assert.equal(am.initiator, true)
    assert.equal(bm.initiator, false)

    // Neither side may create/send an offer merely from "matched" —
    // nothing has said "rtc-start" yet.
    await assert.rejects(() => a.waitForType("signal", 150), /timed out/, "no offer before rtc-start")
    await assert.rejects(() => a.waitForType("rtc-start", 150), /timed out/, "rtc-start requires BOTH sides ready — only one so far is none")

    b.send({ type: "rtc-ready", roomId: bm.roomId })
    // Still only one side ready — rtc-start must not fire yet.
    await assert.rejects(() => a.waitForType("rtc-start", 150), /timed out/)

    a.send({ type: "rtc-ready", roomId: am.roomId })
    const start = await a.waitForType("rtc-start")
    assert.equal(start.roomId, am.roomId)
    // Only the DESIGNATED INITIATOR ever receives "rtc-start" — b (the
    // non-initiator) must never see it at all.
    await assert.rejects(() => b.waitForType("rtc-start", 150), /timed out/)

    // The initiator sends exactly one initial offer, which reaches the
    // recipient; the recipient's answer reaches the initiator back.
    a.send({ type: "signal", roomId: am.roomId, data: { kind: "offer", sdp: "initial-offer" } })
    assert.deepEqual((await b.waitForType("signal")).data, { kind: "offer", sdp: "initial-offer" })
    b.send({ type: "signal", roomId: bm.roomId, data: { kind: "answer", sdp: "initial-answer" } })
    assert.deepEqual((await a.waitForType("signal")).data, { kind: "answer", sdp: "initial-answer" })

    a.close(); b.close()
  } finally {
    await server.close()
  }
})

test("direct call: an rtc-ready for the wrong roomId never counts toward starting negotiation", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("wrong-a")
    const bId = uid("wrong-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const am = await a.waitForType("matched")
    await b.waitForType("matched")

    // b sends rtc-ready for a made-up room that was never actually theirs.
    b.send({ type: "rtc-ready", roomId: "not-a-real-room-id" })
    a.send({ type: "rtc-ready", roomId: am.roomId })
    // a is ready, b's real room is still not — rtc-start must not fire.
    await assert.rejects(() => a.waitForType("rtc-start", 150), /timed out/)

    // The genuine rtc-ready for the real room completes the handshake normally.
    b.send({ type: "rtc-ready", roomId: am.roomId })
    const start = await a.waitForType("rtc-start")
    assert.equal(start.roomId, am.roomId)
    a.close(); b.close()
  } finally {
    await server.close()
  }
})

test("direct call: an rtc-ready for a PREVIOUS, already-ended room cannot activate a new one", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("prev-a")
    const bId = uid("prev-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })

    // First call — completed and left, entirely mundane.
    const firstInvite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: firstInvite.id, accept: true })
    const firstA = await a.waitForType("matched")
    await b.waitForType("matched")
    a.send({ type: "rtc-ready", roomId: firstA.roomId })
    b.send({ type: "rtc-ready", roomId: firstA.roomId })
    await a.waitForType("rtc-start")
    b.send({ type: "leave" })
    await a.waitForType("peer-left")

    // Second call — a genuinely new room.
    const secondInvite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: secondInvite.id, accept: true })
    const secondA = await a.waitForType("matched")
    await b.waitForType("matched")
    assert.notEqual(secondA.roomId, firstA.roomId, "a genuinely different room")

    // a replays an rtc-ready for the FIRST (now long-gone) room. Must have
    // zero effect on the second room's own readiness.
    a.send({ type: "rtc-ready", roomId: firstA.roomId })
    b.send({ type: "rtc-ready", roomId: secondA.roomId })
    await assert.rejects(() => a.waitForType("rtc-start", 150), /timed out/, "the stale room's rtc-ready must not satisfy the new room")

    // The real rtc-ready for the second room completes it normally.
    a.send({ type: "rtc-ready", roomId: secondA.roomId })
    const start = await a.waitForType("rtc-start")
    assert.equal(start.roomId, secondA.roomId)
    a.close(); b.close()
  } finally {
    await server.close()
  }
})

test("direct call: one side never becomes rtc-ready — the room is destroyed after the setup deadline and both sides are cleanly notified, never stuck", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  roomSetupTestConfig.deadlineMs = 80
  const server = await startTestServer()
  try {
    const aId = uid("stale-a")
    const bId = uid("stale-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const am = await a.waitForType("matched")
    const bm = await b.waitForType("matched")

    // Only the recipient becomes rtc-ready — the inviter's tab is
    // simulated as stale/backgrounded: it never sends "rtc-ready" at all.
    b.send({ type: "rtc-ready", roomId: bm.roomId })

    const [aFailed, bFailed] = await Promise.all([
      a.waitForType("room-setup-failed", 1000),
      b.waitForType("room-setup-failed", 1000),
    ])
    assert.equal(aFailed.roomId, am.roomId)
    assert.equal(bFailed.roomId, am.roomId)
    assert.equal(aFailed.source, "friend")
    assert.equal(bFailed.source, "friend")

    // The room is genuinely gone server-side — a fresh invite works right
    // after, on a clean slate (no ghost room blocking either side).
    const secondInvite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: secondInvite.id, accept: true })
    const secondA = await a.waitForType("matched")
    assert.notEqual(secondA.roomId, am.roomId)
    a.close(); b.close()
  } finally {
    await server.close()
    roomSetupTestConfig.deadlineMs = DEFAULT_DEADLINE_MS
  }
})

test("direct call: inviter disconnecting immediately after Accept ends the room cleanly for the accepter — no stuck Connecting", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("gone-a")
    const bId = uid("gone-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await a.waitForType("matched")
    await b.waitForType("matched")

    a.close() // the inviter vanishes right after accepting — before ever sending rtc-ready
    // The ordinary socket-close path (not the setup deadline) is what
    // actually ends this — much faster than waiting the full deadline out.
    const peerLeft = await b.waitForType("peer-left", 1000)
    assert.ok(peerLeft.roomId)
    b.close()
  } finally {
    await server.close()
  }
})

test("direct call: recipient disconnecting during setup ends the room cleanly for the inviter", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("rgone-a")
    const bId = uid("rgone-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const am = await a.waitForType("matched")
    await b.waitForType("matched")

    // The inviter does its own part of the handshake normally...
    a.send({ type: "rtc-ready", roomId: am.roomId })
    // ...then the recipient vanishes mid-setup, before ever responding.
    b.close()
    const peerLeft = await a.waitForType("peer-left", 1000)
    assert.ok(peerLeft.roomId)
    a.close()
  } finally {
    await server.close()
  }
})

test("direct call: a socket replacement mid-setup cannot preserve a ghost room — exactly one termination notice, never a later room-setup-failed too", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  roomSetupTestConfig.deadlineMs = 150
  const server = await startTestServer()
  try {
    const aId = uid("replace-a")
    const bId = uid("replace-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    await a.waitForType("matched")
    const bm = await b.waitForType("matched")

    // `a` is idle-per-the-handshake (no room-exclusive activity from the
    // ownership policy's own point of view is irrelevant here — it DOES
    // have a room, so a duplicate hello for it would normally be rejected
    // by the SAME-account ownership policy; what this test actually
    // exercises is a REAL reconnect: the old socket dies without a clean
    // close first, exactly like AGENTS' own "socket_replaced" case).
    a.close()
    await new Promise((r) => setTimeout(r, 60)) // let the close handler actually run
    const replacement = await connectAndHello(server.url, aId, { gender: "male" })

    // The room is already gone — b gets exactly one "peer-left" from the
    // ordinary disconnect path, and the replacement is free to do
    // something else entirely (not stuck inheriting a ghost room).
    const peerLeft = await b.waitForType("peer-left", 1000)
    assert.equal(peerLeft.roomId, bm.roomId)

    // The setup deadline (still armed when `a` disconnected) must not
    // ALSO fire a redundant "room-setup-failed" once it elapses — the
    // room was already torn down by the ordinary close path.
    await assert.rejects(() => b.waitForType("room-setup-failed", 400), /timed out/, "no duplicate termination notice")
    replacement.close(); b.close()
  } finally {
    await server.close()
    roomSetupTestConfig.deadlineMs = DEFAULT_DEADLINE_MS
  }
})

test("direct call: matched source is \"friend\" (never implies random-match intent); a random match's own source is \"random\"", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("src-friend-a")
    const bId = uid("src-friend-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })
    const invite = await inviteAndAwait(a, bId, b)
    b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
    const am = await a.waitForType("matched")
    assert.equal(am.source, "friend")
    // The friend call's own partner leaving must carry through to the
    // client as "peer-left" — useMatchmaking.ts is what actually decides
    // (via roomSourceRef, set from this exact field) to route this to
    // idle rather than random-match auto-retry; the server's only job is
    // making sure "matched" told it the truth in the first place.
    b.send({ type: "leave" })
    await a.waitForType("peer-left")
    a.close(); b.close()

    const c = await connectAndHello(server.url, uid("src-random-c"), { gender: "male" })
    const d = await connectAndHello(server.url, uid("src-random-d"), { gender: "female" })
    c.send({ type: "find" }); d.send({ type: "find" })
    const cm = await c.waitForType("matched")
    const dm = await d.waitForType("matched")
    assert.equal(cm.source, "random")
    assert.equal(dm.source, "random")
    c.close(); d.close()
  } finally {
    await server.close()
  }
})

test("direct call: repeated invite -> accept -> handshake -> leave -> invite again, 20 times, never leaves a stale room or a stuck setup", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => true
  const server = await startTestServer()
  try {
    const aId = uid("soak-a")
    const bId = uid("soak-b")
    const a = await connectAndHello(server.url, aId, { gender: "male" })
    const b = await connectAndHello(server.url, bId, { gender: "female" })

    const seenRoomIds = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const invite = await inviteAndAwait(a, bId, b)
      b.send({ type: "match-invite-respond", invitationId: invite.id, accept: true })
      const am = await a.waitForType("matched", 1000)
      const bm = await b.waitForType("matched", 1000)
      assert.equal(am.roomId, bm.roomId, `iteration ${i}: both sides in the same room`)
      assert.equal(am.source, "friend")
      assert.ok(!seenRoomIds.has(am.roomId), `iteration ${i}: never a stale/reused roomId`)
      seenRoomIds.add(am.roomId)

      b.send({ type: "rtc-ready", roomId: bm.roomId })
      a.send({ type: "rtc-ready", roomId: am.roomId })
      const start = await a.waitForType("rtc-start", 1000)
      assert.equal(start.roomId, am.roomId, `iteration ${i}: rtc-start for the right room`)
      // The full offer/answer relay is already covered by the dedicated
      // handshake test above — repeating it 20x here would only add
      // message volume without adding coverage, and risks tripping the
      // server's own per-connection spam guard (a real, intentional
      // safeguard — see checkRate()'s own doc comment — not something
      // this test should need to work around by sending unrealistically
      // fast bursts no real client would).

      a.send({ type: "leave" })
      await b.waitForType("peer-left", 1000)
      // Both sides must be genuinely free to invite again immediately —
      // no leftover room/seeking/invitation state from this iteration.
      // A realistic pause between iterations — this loop already sends
      // real messages faster than any actual person tapping through an
      // invite/accept/hang-up cycle would. Comfortably spreads 20
      // iterations' worth of messages (5/iteration across both
      // connections) out past checkRate()'s own 2-second sliding window
      // (RATE_LIMIT=60) well before it would ever matter — the point of
      // this test is repetition correctness, not throughput, and it
      // should never need to lean on a real, intentional spam guard being
      // loose enough to survive an unrealistically fast scripted burst.
      await new Promise((r) => setTimeout(r, 200))
    }
    a.close(); b.close()
  } finally {
    await server.close()
  }
})
