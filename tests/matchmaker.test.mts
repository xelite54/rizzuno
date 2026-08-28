import { test, mock } from "node:test"
import assert from "node:assert/strict"

mock.module("../lib/db.ts", {
  exports: {
    isBlockedEitherWay: async () => false,
  },
})

// Dynamic, not top-level-await, import — mock.module() above must still
// register before server/matchmaker.ts (which imports lib/db.ts) is ever
// loaded, which dynamic import (awaited inside an async function) preserves
// just as well as a top-level one would.
const { Matchmaker } = await import("../server/matchmaker")

const alwaysLive = () => true
let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

// Every test creates its OWN Matchmaker instance — the real app only ever
// needs the one singleton (server/matchmaker.ts's `matchmaker` export), but
// sharing one across many test cases would let one test's leftover,
// never-matched queue entries interfere with a later test's assumptions
// about who else is in the queue. Isolated instances make every test
// self-contained regardless of run order.

// Test 1
test("fresh male + female both end up reserved into the same room", async () => {
  const matchmaker = new Matchmaker()
  const m = uid("m")
  const f = uid("f")
  const first = await matchmaker.reserveMatch({ userId: m, gender: "male", enqueuedAt: Date.now(), debugId: m }, alwaysLive)
  assert.equal(first, null, "first arrival just queues — nobody to pair with yet")

  const room = await matchmaker.reserveMatch({ userId: f, gender: "female", enqueuedAt: Date.now(), debugId: f }, alwaysLive)
  assert.ok(room, "opposite-gender candidate is reserved into a room")
  assert.equal(room!.a, f)
  assert.equal(room!.b, m)
})

// Test 2
test("male + male both stay queued — never reserved together", async () => {
  const matchmaker = new Matchmaker()
  const a = uid("m")
  const b = uid("m")
  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a }, alwaysLive)
  assert.equal(matchmaker.queueSize, 1)
  const result = await matchmaker.reserveMatch({ userId: b, gender: "male", enqueuedAt: Date.now(), debugId: b }, alwaysLive)
  assert.equal(result, null, "same gender is never reserved as a pair")
  assert.equal(matchmaker.queueSize, 2, "both a and b end up queued, never matched to each other")
})

// Test 4 — candidate disconnects during the DB block lookup.
test("candidate disappearing mid-lookup is skipped, not reserved — no ghost room", async () => {
  const matchmaker = new Matchmaker()
  const survivor = uid("m")
  const vanished = uid("f")
  await matchmaker.reserveMatch({ userId: vanished, gender: "female", enqueuedAt: Date.now(), debugId: vanished }, alwaysLive)

  // isLive says the candidate (the one already queued, `vanished`) is gone.
  const isLive = (userId: string) => userId !== vanished
  const result = await matchmaker.reserveMatch(
    { userId: survivor, gender: "male", enqueuedAt: Date.now(), debugId: survivor },
    isLive
  )
  assert.equal(result, null, "no room reserved against a candidate that's no longer live")
})

// Test 5 — the initiator itself disconnects during the DB lookup.
test("initiator disappearing mid-lookup abandons the attempt — the candidate stays queued for someone else", async () => {
  const matchmaker = new Matchmaker()
  const stillWaiting = uid("f")
  const vanishingInitiator = uid("m")
  await matchmaker.reserveMatch({ userId: stillWaiting, gender: "female", enqueuedAt: Date.now(), debugId: stillWaiting }, alwaysLive)

  // isLive says the INITIATOR itself (vanishingInitiator) is gone, but the
  // candidate already in queue (stillWaiting) is fine.
  const isLive = (userId: string) => userId !== vanishingInitiator
  const result = await matchmaker.reserveMatch(
    { userId: vanishingInitiator, gender: "male", enqueuedAt: Date.now(), debugId: vanishingInitiator },
    isLive
  )
  assert.equal(result, null, "nothing reserved for a vanished initiator")
  assert.equal(matchmaker.queueSize, 1, "stillWaiting was never removed from the queue")

  // stillWaiting must still be matchable by the next real comer.
  const nextComer = uid("m")
  const room = await matchmaker.reserveMatch(
    { userId: nextComer, gender: "male", enqueuedAt: Date.now(), debugId: nextComer },
    alwaysLive
  )
  assert.ok(room, "the candidate that was never actually removed is still there to match")
  assert.equal(room!.b, stillWaiting)
})

// Test 6 + 7 — recent-partner cooldown only applies after commitMatch, never after a bare reservation or a rollback.
test("a reservation that's never committed records NO recent-partner cooldown", async () => {
  const matchmaker = new Matchmaker()
  const a = uid("m")
  const b = uid("f")
  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a }, alwaysLive)
  const room = await matchmaker.reserveMatch({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b }, alwaysLive)
  assert.ok(room)

  // Roll back instead of committing — simulates ws-server finding one side's
  // ConnectionState gone right after reservation.
  matchmaker.rollbackMatch(room!.id, null)
  assert.equal(matchmaker.getRoom(room!.id), undefined, "room mapping fully removed")

  // If a cooldown HAD been recorded, these two (still opposite gender, never
  // re-queued yet) would skip each other. Since nothing was ever committed,
  // they must be able to reserve together again immediately.
  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a }, alwaysLive)
  const secondAttempt = await matchmaker.reserveMatch({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b }, alwaysLive)
  assert.ok(secondAttempt, "no cooldown from the rolled-back reservation — they can match now")
})

test("committing a match DOES record the recent-partner cooldown — the same pair can't immediately re-match", async () => {
  const matchmaker = new Matchmaker()
  const a = uid("m")
  const b = uid("f")
  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a }, alwaysLive)
  const room = await matchmaker.reserveMatch({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b }, alwaysLive)
  assert.ok(room)
  matchmaker.commitMatch(room!.id)

  // Both leave their (simulated) call and immediately try to find someone
  // new — but there's a third account, `c`, also opposite-gender to `a`,
  // waiting. `a` and `b` must not be offered to each other again; `a` and
  // `c` must still be able to match.
  matchmaker.leaveRoom(a)
  matchmaker.leaveRoom(b)
  const c = uid("f")
  await matchmaker.reserveMatch({ userId: c, gender: "female", enqueuedAt: Date.now(), debugId: c }, alwaysLive)
  const rematch = await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a }, alwaysLive)
  assert.ok(rematch, "a matches someone")
  assert.equal(rematch!.b, c, "a matched c, not b — the recent-partner cooldown correctly kept b out of consideration")
})

// Test 9 — gender changes while queued: reserveMatch always removes the
// caller's own prior queue entry first, so re-calling it with an updated
// gender is exactly how ws-server re-evaluates a queued account after a
// profile-update (see server/ws-server.ts's "profile-update" handler).
test("re-reserving with a changed gender replaces the old queue snapshot — matching uses the NEW gender only", async () => {
  const matchmaker = new Matchmaker()
  const changer = uid("switcher")
  const maleCandidate = uid("m")

  // Queued as male first.
  await matchmaker.reserveMatch({ userId: changer, gender: "male", enqueuedAt: Date.now(), debugId: changer }, alwaysLive)

  // A male candidate arrives — must NOT match (changer is currently "male" too).
  const shouldNotMatch = await matchmaker.reserveMatch(
    { userId: maleCandidate, gender: "male", enqueuedAt: Date.now(), debugId: maleCandidate },
    alwaysLive
  )
  assert.equal(shouldNotMatch, null, "still both male at this point")
  assert.equal(matchmaker.queueSize, 2)

  // Now `changer` switches to female and re-reserves (mirrors the
  // gender-changed-while-queued path) — this removes the stale male queue
  // entry and re-adds as female.
  const afterGenderChange = await matchmaker.reserveMatch(
    { userId: changer, gender: "female", enqueuedAt: Date.now(), debugId: changer },
    alwaysLive
  )
  // maleCandidate is still queued (male), changer is now female -> opposite genders -> should match immediately.
  assert.ok(afterGenderChange, "changer (now female) immediately matches the waiting male candidate")
  assert.equal(afterGenderChange!.b, maleCandidate)
})
