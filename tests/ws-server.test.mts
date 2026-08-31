import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello, TestClient } from "./helpers/wsHarness.mts"
import { dbMockState, resetDbMockState } from "./helpers/dbMock.mts"

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

// Every test boots its OWN server instance on its own ephemeral port and
// uses unique userIds — server/ws-server.ts's `connections` map and
// server/matchmaker.ts's singleton `matchmaker` are both module-level
// state, so a fresh HTTP/WS server per test (closed in a `finally`) plus
// never-reused ids together guarantee no cross-test interference without
// needing to reach into either module's internals to reset them.

// Test 1
test("fresh male + female: both receive matched with each other", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const m = uid("m")
    const f = uid("f")
    const male = await connectAndHello(server.url, m, { username: "male-user", gender: "male" })
    male.send({ type: "find" })
    await male.waitForType("queued")

    const female = await connectAndHello(server.url, f, { username: "female-user", gender: "female" })
    female.send({ type: "find" })

    const [maleMatched, femaleMatched] = await Promise.all([male.waitForType("matched"), female.waitForType("matched")])
    assert.equal(maleMatched.peer.username, "female-user")
    assert.equal(femaleMatched.peer.username, "male-user")
    assert.equal(maleMatched.roomId, femaleMatched.roomId)
    assert.notEqual(maleMatched.initiator, femaleMatched.initiator, "exactly one side is the offer initiator")
    male.close()
    female.close()
  } finally {
    await server.close()
  }
})

// Test 2
test("male + male: both stay queued, never matched to each other", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("m"), { gender: "male" })
    a.send({ type: "find" })
    await a.waitForType("queued")

    const b = await connectAndHello(server.url, uid("m"), { gender: "male" })
    b.send({ type: "find" })
    await b.waitForType("queued")

    // Neither should ever get "matched" — give it a beat to make sure
    // nothing arrives, then confirm.
    await new Promise((r) => setTimeout(r, 150))
    await assert.rejects(a.waitForType("matched", 50))
    await assert.rejects(b.waitForType("matched", 50))
    a.close()
    b.close()
  } finally {
    await server.close()
  }
})

// Test 3
test("areFriends throwing does NOT cancel the match — matched is still sent, alreadyFriends comes back false", async () => {
  resetDbMockState()
  dbMockState.areFriendsImpl = async () => {
    throw new Error("simulated Friends DB outage")
  }
  const server = await startTestServer()
  try {
    const male = await connectAndHello(server.url, uid("m"), { gender: "male" })
    male.send({ type: "find" })
    await male.waitForType("queued")

    const female = await connectAndHello(server.url, uid("f"), { gender: "female" })
    female.send({ type: "find" })

    const [maleMatched, femaleMatched] = await Promise.all([male.waitForType("matched"), female.waitForType("matched")])
    assert.equal(maleMatched.alreadyFriends, false, "failed lookup degrades to false, not a crash")
    assert.equal(femaleMatched.alreadyFriends, false)
    male.close()
    female.close()
  } finally {
    await server.close()
  }
})

// Test 18
test("a Friends-DB failure during hello does not stop 'ready' or matchmaking from working", async () => {
  resetDbMockState()
  dbMockState.friendsSnapshotShouldThrow = true
  const server = await startTestServer()
  try {
    // connectAndHello itself asserts "ready" arrives — if Friends were a
    // hard prerequisite for it, this alone would time out and fail.
    const male = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const female = await connectAndHello(server.url, uid("f"), { gender: "female" })
    male.send({ type: "find" })
    female.send({ type: "find" })
    const [maleMatched, femaleMatched] = await Promise.all([male.waitForType("matched"), female.waitForType("matched")])
    assert.ok(maleMatched.roomId)
    assert.ok(femaleMatched.roomId)
    male.close()
    female.close()
  } finally {
    await server.close()
  }
})

// Test 12 (server-side contract) + honesty note: the client's own
// "still wants matching -> auto find" decision lives in
// hooks/useMatchmaking.ts (a React hook, not covered by this Node-only
// suite) — what's verified here is the SERVER's half of the contract: the
// peer is told immediately, the block is honestly acknowledged, and a
// follow-up "find" from the blocker (exactly what the real client sends
// next) succeeds normally.
test("block: partner is told immediately, block is acknowledged ok, and blocker can queue again right after", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const blocker = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const target = await connectAndHello(server.url, uid("f"), { gender: "female" })
    blocker.send({ type: "find" })
    target.send({ type: "find" })
    const matched = await blocker.waitForType("matched")

    blocker.send({ type: "block", roomId: matched.roomId })
    const [ack, peerLeft] = await Promise.all([blocker.waitForType("blocked"), target.waitForType("peer-left")])
    assert.equal(ack.ok, true, "block was actually persisted")
    assert.equal(peerLeft.roomId, matched.roomId)

    // Blocker tries to find someone again — should queue normally (not
    // stuck, not erroring).
    blocker.send({ type: "find" })
    await blocker.waitForType("queued")
    blocker.close()
    target.close()
  } finally {
    await server.close()
  }
})

test("block: a database failure is honestly reported as ok:false, never faked as success", async () => {
  resetDbMockState()
  dbMockState.addBlockShouldThrow = true
  const server = await startTestServer()
  try {
    const blocker = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const target = await connectAndHello(server.url, uid("f"), { gender: "female" })
    blocker.send({ type: "find" })
    target.send({ type: "find" })
    const matched = await blocker.waitForType("matched")

    blocker.send({ type: "block", roomId: matched.roomId })
    const ack = await blocker.waitForType("blocked")
    assert.equal(ack.ok, false, "a failed DB write must never be reported as a successful block")
    blocker.close()
    target.close()
  } finally {
    await server.close()
  }
})

// Test 13
test("unblock makes a previously-blocked pair eligible to match again", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = uid("m")
    const b = uid("f")
    dbMockState.blockedPairs.add([a, b].sort().join("|"))

    const male = await connectAndHello(server.url, a, { gender: "male" })
    const female = await connectAndHello(server.url, b, { gender: "female" })
    male.send({ type: "find" })
    await male.waitForType("queued")
    female.send({ type: "find" })
    await female.waitForType("queued")
    await new Promise((r) => setTimeout(r, 100))
    await assert.rejects(male.waitForType("matched", 50), "still blocked — must not match")

    male.send({ type: "unblock", targetUserId: b })
    const unblockAck = await male.waitForType("unblocked")
    assert.equal(unblockAck.ok, true)

    // Server re-evaluates the queue automatically for the account that was
    // already queued (male) — see server/ws-server.ts's "unblock" handler.
    const matched = await male.waitForType("matched")
    assert.ok(matched.roomId)
    male.close()
    female.close()
  } finally {
    await server.close()
  }
})

// Test 15 (server-side: "leave" — what sign-out sends best-effort, and what
// a real socket close guarantees regardless).
test("leaving the queue (sign-out / pause / camera-off all send this) removes the entry — no ghost candidate", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const leaving = await connectAndHello(server.url, uid("m"), { gender: "male" })
    leaving.send({ type: "find" })
    await leaving.waitForType("queued")
    leaving.send({ type: "leave" })
    // Give the server a moment to process the leave before the next comer.
    await new Promise((r) => setTimeout(r, 50))

    const other = await connectAndHello(server.url, uid("f"), { gender: "female" })
    other.send({ type: "find" })
    await other.waitForType("queued")
    // Confirm no match ever arrives — the queue is genuinely empty of `leaving`.
    await assert.rejects(other.waitForType("matched", 150))
    leaving.close()
    other.close()
  } finally {
    await server.close()
  }
})

test("closing the socket outright (sign-out with no chance to send 'leave') also removes the queue entry", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const leaving = await connectAndHello(server.url, uid("m"), { gender: "male" })
    leaving.send({ type: "find" })
    await leaving.waitForType("queued")
    leaving.close()
    await new Promise((r) => setTimeout(r, 100))

    const other = await connectAndHello(server.url, uid("f"), { gender: "female" })
    other.send({ type: "find" })
    await other.waitForType("queued")
    await assert.rejects(other.waitForType("matched", 150))
    other.close()
  } finally {
    await server.close()
  }
})

// Test 16
test("account A -> account B on the SAME socket: A is completely gone before B is attached", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const a = uid("m")
    const b = uid("f")
    const socket = new TestClient(server.url)
    await socket.waitForOpen()

    // hello as A, queue as A.
    const { mintTicket } = await import("../lib/realtimeTicket")
    socket.send({ type: "hello", ticket: mintTicket(a), handle: "a-handle", gender: "male", profilePhoto: null })
    await socket.waitForType("ready")
    socket.send({ type: "find" })
    await socket.waitForType("queued")

    // hello as B on the exact same socket, no close in between.
    socket.send({ type: "hello", ticket: mintTicket(b), handle: "b-handle", gender: "female", profilePhoto: null })
    await socket.waitForType("ready")

    // A candidate opposite A's old gender (i.e. female) must NOT match A —
    // A's queue entry must have been removed the instant B's hello landed.
    const candidate = await connectAndHello(server.url, uid("f2"), { gender: "female" })
    candidate.send({ type: "find" })
    await candidate.waitForType("queued")
    await assert.rejects(candidate.waitForType("matched", 150), "A must be gone — nothing should have matched it")

    socket.close()
    candidate.close()
  } finally {
    await server.close()
  }
})

// Test 9 + 10 (profile-update revisions / gender live-updates the queue)
test("gender change while queued (via profile-update) removes the stale queue snapshot and matches on the new gender", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const switcher = await connectAndHello(server.url, uid("switch"), { gender: "male" })
    switcher.send({ type: "find" })
    await switcher.waitForType("queued")

    const maleCandidate = await connectAndHello(server.url, uid("m"), { gender: "male" })
    maleCandidate.send({ type: "find" })
    await maleCandidate.waitForType("queued") // same gender as switcher right now — must not match

    switcher.send({ type: "profile-update", revision: 1, gender: "female" })
    const matched = await maleCandidate.waitForType("matched")
    assert.ok(matched.roomId, "switcher (now female) matched the waiting male candidate")
    switcher.close()
    maleCandidate.close()
  } finally {
    await server.close()
  }
})

test("rapid male -> female -> male profile-updates converge on male (revisions applied strictly in order, stale ones ignored)", async () => {
  resetDbMockState()
  const server = await startTestServer()
  try {
    const switcher = await connectAndHello(server.url, uid("switch"), { gender: "male" })
    switcher.send({ type: "profile-update", revision: 1, gender: "female" })
    switcher.send({ type: "profile-update", revision: 2, gender: "male" })
    // A stale, out-of-order revision arriving late must be ignored, not
    // overwrite the newer one.
    switcher.send({ type: "profile-update", revision: 1, gender: "female" })
    await new Promise((r) => setTimeout(r, 100))

    switcher.send({ type: "find" })
    await switcher.waitForType("queued")

    // switcher must have landed on "male" — a MALE candidate must NOT
    // match it (proves it didn't stay/revert to female).
    const maleCandidate = await connectAndHello(server.url, uid("m"), { gender: "male" })
    maleCandidate.send({ type: "find" })
    await maleCandidate.waitForType("queued")
    await assert.rejects(maleCandidate.waitForType("matched", 150), "switcher must read as male — a male candidate must not match it")

    // ...and a FEMALE candidate SHOULD match it — confirms switcher is
    // genuinely male, not just "not visibly female" by omission.
    const femaleCandidate = await connectAndHello(server.url, uid("f"), { gender: "female" })
    femaleCandidate.send({ type: "find" })
    const matched = await femaleCandidate.waitForType("matched")
    assert.ok(matched.roomId)
    switcher.close()
    femaleCandidate.close()
    maleCandidate.close()
  } finally {
    await server.close()
  }
})

// Test 4/5 integration-level (matchmaker unit tests already cover the pure
// logic — this exercises the SAME race through a real socket/timing gap).
test("candidate disconnecting mid block-lookup does not produce a ghost match — initiator ends up queued instead", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const candidate = await connectAndHello(server.url, uid("f"), { gender: "female" })
    candidate.send({ type: "find" })
    await candidate.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m"), { gender: "male" })
    initiator.send({ type: "find" }) // triggers the (delayed) block check against `candidate`
    // Disconnect the candidate WHILE that check is still in flight.
    await new Promise((r) => setTimeout(r, 40))
    candidate.close()

    // The initiator must end up queued (not matched to a ghost), and no
    // "matched" ever arrives for it.
    await initiator.waitForType("queued", 1000)
    await assert.rejects(initiator.waitForType("matched", 100))
    initiator.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})

// Test 11
test("pausing (leave) during an in-flight block-lookup means the pauser is never subsequently matched", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const pauser = await connectAndHello(server.url, uid("f"), { gender: "female" })
    pauser.send({ type: "find" })
    await pauser.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m"), { gender: "male" })
    initiator.send({ type: "find" }) // starts the delayed block check against `pauser`
    await new Promise((r) => setTimeout(r, 40))
    pauser.send({ type: "leave" }) // pauses mid-lookup, socket stays open

    await new Promise((r) => setTimeout(r, 200)) // let the delayed check resolve
    await assert.rejects(pauser.waitForType("matched", 100), "paused mid-lookup — must not have been matched")
    pauser.close()
    initiator.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})

// Test 2 (of the new set) — camera-off sends the exact same "leave"
// message pause does (see hooks/useMatchmaking.ts's leaveQueueOnly), so
// this exercises the identical server-side code path as the pause test
// above — kept as its own named test since the requirement calls it out
// separately, and to guard against the two ever being implemented
// differently on the client side in the future.
test("camera-off (also sends 'leave') during a delayed DB block check means the account is never subsequently matched", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const cameraOffUser = await connectAndHello(server.url, uid("f"), { gender: "female" })
    cameraOffUser.send({ type: "find" })
    await cameraOffUser.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m"), { gender: "male" })
    initiator.send({ type: "find" })
    await new Promise((r) => setTimeout(r, 40))
    // What MatchStage's camera-off effect actually sends server-side.
    cameraOffUser.send({ type: "leave" })

    await new Promise((r) => setTimeout(r, 200))
    await assert.rejects(cameraOffUser.waitForType("matched", 100), "camera turned off mid-lookup — must not have been matched")
    cameraOffUser.close()
    initiator.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})

// Test 3 (of the new set) — the INITIATOR disconnecting mid-lookup (the
// candidate-disconnects version already exists above under "candidate
// disconnecting mid block-lookup...").
test("initiator disconnecting during its own delayed DB block check aborts cleanly — no ghost room, candidate stays queued", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const candidate = await connectAndHello(server.url, uid("f"), { gender: "female" })
    candidate.send({ type: "find" })
    await candidate.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m"), { gender: "male" })
    initiator.send({ type: "find" }) // starts the delayed block check
    await new Promise((r) => setTimeout(r, 40))
    initiator.close() // the INITIATOR vanishes mid-lookup this time

    await new Promise((r) => setTimeout(r, 200))
    // The candidate must never have been pulled into a ghost match, and
    // must still be available to the next real comer.
    await assert.rejects(candidate.waitForType("matched", 100))
    const nextComer = await connectAndHello(server.url, uid("m"), { gender: "male" })
    nextComer.send({ type: "find" })
    const matched = await nextComer.waitForType("matched")
    assert.ok(matched.roomId, "candidate is still queued and matchable after the initiator vanished")
    candidate.close()
    nextComer.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})

// Test 4 (of the new set) — stale searchGeneration cannot commit: the
// candidate leaves and immediately re-finds (a brand new search generation)
// WHILE the initiator's block-check against the OLD snapshot is still
// pending.
test("a candidate that leaves and re-finds mid-lookup (new searchGeneration) is never matched using the stale snapshot", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const flakyCandidateId = uid("f")
    const flakyCandidate = await connectAndHello(server.url, flakyCandidateId, { gender: "female" })
    flakyCandidate.send({ type: "find" })
    await flakyCandidate.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m"), { gender: "male" })
    initiator.send({ type: "find" }) // block-check against flakyCandidate's CURRENT (generation 1) snapshot begins
    await new Promise((r) => setTimeout(r, 40))

    // Leave, then immediately re-find — a brand new searchGeneration,
    // still well before the delayed block-check resolves.
    flakyCandidate.send({ type: "leave" })
    flakyCandidate.send({ type: "find" })
    await flakyCandidate.waitForType("queued")

    // The initiator's ORIGINAL "find" only ever scanned the queue as it
    // stood at that instant — the stale (pre-leave) flakyCandidate entry
    // was the only candidate in that snapshot. Once that's proven stale
    // (generation mismatch), there's nothing else in THIS attempt's scan to
    // fall back to, so it correctly ends up queued itself — never matched
    // against the ghost entry. (Both are now legitimately waiting; nothing
    // in this exact interleaving is what makes them find each other — a
    // fresh scan does, exercised next.)
    await initiator.waitForType("queued", 1000)
    await assert.rejects(initiator.waitForType("matched", 100), "must never match the stale snapshot")

    // A fresh find now scans the queue as it CURRENTLY stands — both
    // correctly present — and matches them for real.
    initiator.send({ type: "find" })
    const matched = await initiator.waitForType("matched", 1000)
    assert.ok(matched.roomId)
    flakyCandidate.close()
    initiator.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})

// Test 5 — a socket closes in the gap between a room being reserved and
// "matched" actually being dispatched (the Friends lookup, artificially
// delayed here to create a real window for it).
test("a socket closing right before 'matched' would be sent rolls back the room and requeues the survivor", async () => {
  resetDbMockState()
  dbMockState.friendsCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const doomed = await connectAndHello(server.url, uid("f"), { gender: "female" })
    doomed.send({ type: "find" })
    await doomed.waitForType("queued")

    const survivor = await connectAndHello(server.url, uid("m"), { gender: "male" })
    survivor.send({ type: "find" }) // reserves against `doomed`, then starts the delayed Friends lookup

    // Close the doomed side WHILE that lookup is still pending — well
    // after the room was reserved, well before "matched" would be sent.
    await new Promise((r) => setTimeout(r, 40))
    doomed.close()

    // The survivor must never receive a ghost "matched" for a partner
    // that's already gone — it should end up requeued instead.
    await assert.rejects(survivor.waitForType("matched", 400), "must not be matched against a socket that already closed")
    await survivor.waitForType("queued", 400)
    survivor.close()
  } finally {
    await server.close()
    dbMockState.friendsCheckDelayMs = 0
  }
})

// Test 6 — the other half of test 5's guarantee: no recent-partner cooldown
// from a match that was reserved but never actually delivered.
test("a match that fails right before delivery records NO recent-partner cooldown — the survivor can match the same partner again", async () => {
  resetDbMockState()
  dbMockState.friendsCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const flakyId = uid("f")
    const survivorId = uid("m")
    const flaky = await connectAndHello(server.url, flakyId, { gender: "female" })
    flaky.send({ type: "find" })
    await flaky.waitForType("queued")

    const survivor = await connectAndHello(server.url, survivorId, { gender: "male" })
    survivor.send({ type: "find" })
    await new Promise((r) => setTimeout(r, 40))
    flaky.close()
    await survivor.waitForType("queued", 400)

    // `flaky` reconnects (a fresh socket/ConnectionState — same account) and
    // finds again — if a cooldown had wrongly been recorded for this pair
    // despite the failed delivery, they'd never be offered to each other
    // again. They must be able to match immediately.
    dbMockState.friendsCheckDelayMs = 0 // no need to re-delay this second attempt
    const flakyAgain = await connectAndHello(server.url, flakyId, { gender: "female" })
    flakyAgain.send({ type: "find" })
    const matched = await survivor.waitForType("matched", 400)
    assert.ok(matched.roomId, "no cooldown was recorded from the failed delivery — they matched immediately")
    flakyAgain.close()
    survivor.close()
  } finally {
    await server.close()
    dbMockState.friendsCheckDelayMs = 0
  }
})

// Test 7 — the specific bug this task's client/server architecture audit
// found: tryMatch(state, expectedGeneration) used to build its queued
// snapshot from the LIVE state.searchGeneration, read fresh at whatever
// moment its own turn on the serialized processingChain happened to start
// — not from `expectedGeneration` itself, the value this specific find/skip
// was actually captured under at message-RECEIPT time. A find/skip queued
// behind a slow, unrelated attempt on the SAME connection could sit long
// enough for a LATER find/leave/find burst on that same connection to bump
// the live generation multiple times before this older one's turn ever
// arrives — and it would silently borrow whatever generation happened to be
// live BY THEN, rather than the one it actually started under.
//
// Concretely reproduced here: `initiator`'s first "find" is delayed (via
// blockCheckDelayMs) checking a throwaway `bystander` already in queue.
// While that's in flight, `initiator` sends find → leave → find in a burst
// — all landing (and their synchronous seeking/searchGeneration mutations
// applying) well before the first find's own processing chain turn is
// reached. Traced against the OLD code: that first find would read the
// (by-then-current) generation, find `bystander` still sitting untouched in
// the queue, and — because that borrowed generation happens to equal
// initiator's own live value at that instant — pass every CheckLive
// re-verification and actually commit a real "matched" to both sides... at
// which point the very next message in the burst (the "leave") runs next
// on the chain and, seeing initiator now has a roomId, tears it straight
// back down — "peer-left" is sent to `bystander` a moment after "matched"
// was. A real bystander, matched and then instantly abandoned, entirely
// because of a race entirely internal to someone else's own client.
test("a find superseded before its own processing chain turn starts cannot borrow a newer generation to deliver (and then instantly retract) a match", async () => {
  resetDbMockState()
  dbMockState.blockCheckDelayMs = 150
  const server = await startTestServer()
  try {
    const bystander = await connectAndHello(server.url, uid("f-bystander"), { gender: "female" })
    bystander.send({ type: "find" })
    await bystander.waitForType("queued")

    const initiator = await connectAndHello(server.url, uid("m-initiator"), { gender: "male" })

    // This first find's own processing won't even START until the delayed
    // block-check against `bystander` resolves (~150ms).
    initiator.send({ type: "find" })

    // Sent immediately after — well within that window — a realistic rapid
    // find → leave → find burst (e.g. an accidental double-tap, undone,
    // retried) on initiator's own connection. Each one's own
    // seeking/searchGeneration mutation applies synchronously at receipt,
    // regardless of the first find still being mid-flight.
    initiator.send({ type: "find" })
    initiator.send({ type: "leave" })
    initiator.send({ type: "find" })

    // With the fix: the FIRST find aborts outright once its turn arrives
    // (its captured generation no longer matches live) — bystander is
    // never touched by it. The final "find" in the burst is the one that
    // legitimately, eventually matches bystander (its own block-check also
    // delayed) — a real, STABLE match, never preceded by one that gets
    // immediately retracted.
    const matched = await bystander.waitForType("matched", 800)
    assert.ok(matched.roomId)
    await assert.rejects(
      bystander.waitForType("peer-left", 200),
      "a delivered match must be stable — it must never be immediately retracted by a stale find's own trailing 'leave' from the same burst"
    )

    bystander.close()
    initiator.close()
  } finally {
    await server.close()
    dbMockState.blockCheckDelayMs = 0
  }
})
