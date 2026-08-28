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
