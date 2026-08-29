import { test, mock } from "node:test"
import assert from "node:assert/strict"
import type { Gender } from "../lib/signaling/protocol"

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

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

/**
 * A minimal, in-memory stand-in for server/ws-server.ts's `connections` map
 * + `makeCheckLive` — lets these tests drive the exact same `CheckLive`
 * contract matchmaker.ts actually depends on (open/seeking/generation/room)
 * without needing a real WebSocket or HTTP server. server/ws-server.ts
 * itself (the real thing, with real sockets) is exercised end-to-end by
 * tests/ws-server.test.mts — this file is specifically for pinning down
 * server/matchmaker.ts's own reserve/commit/abort logic precisely and fast.
 */
type FakeConnection = {
  open: boolean
  seeking: boolean
  searchGeneration: number
  gender?: Gender
  roomId: string | null
}

function makeRegistry() {
  const conns = new Map<string, FakeConnection>()

  function register(userId: string, conn: Partial<FakeConnection> & { gender?: Gender }): FakeConnection {
    const full: FakeConnection = {
      open: true,
      seeking: true,
      searchGeneration: 1,
      roomId: null,
      ...conn,
    }
    conns.set(userId, full)
    return full
  }

  function checkLive(userId: string, expectedGeneration: number): { live: boolean; gender?: Gender } {
    const c = conns.get(userId)
    if (!c) return { live: false }
    if (!c.open) return { live: false }
    if (!c.seeking) return { live: false }
    if (c.searchGeneration !== expectedGeneration) return { live: false }
    if (c.roomId) return { live: false }
    return { live: true, gender: c.gender }
  }

  return { conns, register, checkLive }
}

// Test 1
test("fresh male + female both end up reserved into the same room", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const m = uid("m")
  const f = uid("f")
  registry.register(m, { gender: "male", searchGeneration: 1 })
  registry.register(f, { gender: "female", searchGeneration: 1 })

  const first = await matchmaker.reserveMatch({ userId: m, gender: "male", enqueuedAt: Date.now(), debugId: m, searchGeneration: 1 }, registry.checkLive)
  assert.equal(first, null, "first arrival just queues — nobody to pair with yet")

  const room = await matchmaker.reserveMatch({ userId: f, gender: "female", enqueuedAt: Date.now(), debugId: f, searchGeneration: 1 }, registry.checkLive)
  assert.ok(room, "opposite-gender candidate is reserved into a room")
  assert.equal(room!.a, f)
  assert.equal(room!.b, m)
})

// Test 2
test("male + male both stay queued — never reserved together", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const a = uid("m")
  const b = uid("m")
  registry.register(a, { gender: "male", searchGeneration: 1 })
  registry.register(b, { gender: "male", searchGeneration: 1 })

  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a, searchGeneration: 1 }, registry.checkLive)
  assert.equal(matchmaker.queueSize, 1)
  const result = await matchmaker.reserveMatch({ userId: b, gender: "male", enqueuedAt: Date.now(), debugId: b, searchGeneration: 1 }, registry.checkLive)
  assert.equal(result, null, "same gender is never reserved as a pair")
  assert.equal(matchmaker.queueSize, 2, "both a and b end up queued, never matched to each other")
})

// Test 3 — candidate becomes ineligible (closed socket) mid-lookup.
test("candidate whose socket is no longer OPEN mid-lookup is skipped, not reserved — no ghost room", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const survivor = uid("m")
  const vanished = uid("f")
  registry.register(vanished, { gender: "female", searchGeneration: 1 })
  registry.register(survivor, { gender: "male", searchGeneration: 1 })

  await matchmaker.reserveMatch({ userId: vanished, gender: "female", enqueuedAt: Date.now(), debugId: vanished, searchGeneration: 1 }, registry.checkLive)

  // Socket closes right as the survivor's reserveMatch call is about to
  // check it (simulating a disconnect mid async-block-check, without
  // needing a real delayed await here — this file drives CheckLive
  // directly).
  registry.conns.get(vanished)!.open = false

  const result = await matchmaker.reserveMatch(
    { userId: survivor, gender: "male", enqueuedAt: Date.now(), debugId: survivor, searchGeneration: 1 },
    registry.checkLive
  )
  assert.equal(result, null, "no room reserved against a candidate that's no longer live")
})

// Test 4 — the initiator itself becomes ineligible mid-lookup (paused).
test("initiator that paused mid-lookup abandons the attempt — the candidate stays queued for someone else", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const stillWaiting = uid("f")
  const pausingInitiator = uid("m")
  registry.register(stillWaiting, { gender: "female", searchGeneration: 1 })
  const initiatorConn = registry.register(pausingInitiator, { gender: "male", searchGeneration: 1 })

  await matchmaker.reserveMatch({ userId: stillWaiting, gender: "female", enqueuedAt: Date.now(), debugId: stillWaiting, searchGeneration: 1 }, registry.checkLive)

  // Paused right before the initiator's own liveness gets checked — exactly
  // what hooks/useMatchmaking.ts's "leave" (pause/camera-off) does
  // server-side: seeking=false, searchGeneration bumped.
  initiatorConn.seeking = false
  initiatorConn.searchGeneration += 1

  const result = await matchmaker.reserveMatch(
    { userId: pausingInitiator, gender: "male", enqueuedAt: Date.now(), debugId: pausingInitiator, searchGeneration: 1 },
    registry.checkLive
  )
  assert.equal(result, null, "nothing reserved for a paused initiator")
  assert.equal(matchmaker.queueSize, 1, "stillWaiting was never removed from the queue")

  // stillWaiting must still be matchable by the next real comer.
  const nextComer = uid("m")
  registry.register(nextComer, { gender: "male", searchGeneration: 1 })
  const room = await matchmaker.reserveMatch(
    { userId: nextComer, gender: "male", enqueuedAt: Date.now(), debugId: nextComer, searchGeneration: 1 },
    registry.checkLive
  )
  assert.ok(room, "the candidate that was never actually removed is still there to match")
  assert.equal(room!.b, stillWaiting)
})

// Test — stale searchGeneration cannot commit: the candidate left and
// rejoined (a brand new queue entry, new generation) while an earlier
// reserveMatch call was still holding a snapshot of the OLD entry.
test("a candidate's stale searchGeneration cannot commit — a rejoin during the lookup replaces it", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const initiator = uid("m")
  const flakyCandidate = uid("f")
  registry.register(initiator, { gender: "male", searchGeneration: 1 })
  const candidateConn = registry.register(flakyCandidate, { gender: "female", searchGeneration: 1 })

  await matchmaker.reserveMatch(
    { userId: flakyCandidate, gender: "female", enqueuedAt: Date.now(), debugId: flakyCandidate, searchGeneration: 1 },
    registry.checkLive
  )

  // The candidate leaves and immediately re-finds — a NEW queue entry with
  // a NEW generation, replacing the one already snapshotted below.
  matchmaker.removeFromQueue(flakyCandidate)
  candidateConn.searchGeneration = 2
  matchmaker.requeue({ userId: flakyCandidate, gender: "female", enqueuedAt: Date.now(), debugId: flakyCandidate, searchGeneration: 2 })

  // The initiator's reserveMatch call still only knows about the pre-rejoin
  // world when it starts — but by the time it actually looks, the queue
  // already reflects the rejoin. Since this test drives everything
  // synchronously (no real async gap to land "between" the two), what's
  // actually being proven is that reserveMatch matches against the CURRENT
  // (generation 2) entry, never a stale one — there is no OTHER entry left
  // for it to wrongly use.
  const room = await matchmaker.reserveMatch(
    { userId: initiator, gender: "male", enqueuedAt: Date.now(), debugId: initiator, searchGeneration: 1 },
    registry.checkLive
  )
  assert.ok(room, "still matches — the candidate is legitimately there, just under a newer generation")
  assert.equal(room!.b, flakyCandidate)
})

test("a candidate snapshot whose generation no longer matches the live one is treated as disappeared", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const initiator = uid("m")
  const candidate = uid("f")
  registry.register(initiator, { gender: "male", searchGeneration: 1 })
  const candidateConn = registry.register(candidate, { gender: "female", searchGeneration: 1 })

  await matchmaker.reserveMatch(
    { userId: candidate, gender: "female", enqueuedAt: Date.now(), debugId: candidate, searchGeneration: 1 },
    registry.checkLive
  )

  // The candidate's LIVE generation moves on (e.g. they paused and
  // resumed) without ever leaving/re-entering the `waiting` array itself —
  // simulating the exact moment between that live-state change and the
  // (async, in the real system) moment matchmaker would otherwise use the
  // now-stale snapshot still sitting in `waiting`.
  candidateConn.searchGeneration = 2

  const result = await matchmaker.reserveMatch(
    { userId: initiator, gender: "male", enqueuedAt: Date.now(), debugId: initiator, searchGeneration: 1 },
    registry.checkLive
  )
  assert.equal(result, null, "the stale-generation queue entry must not be used to commit a match")
})

// Recent-partner cooldown ordering
test("a reservation that's never committed records NO recent-partner cooldown", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const a = uid("m")
  const b = uid("f")
  registry.register(a, { gender: "male", searchGeneration: 1 })
  registry.register(b, { gender: "female", searchGeneration: 1 })

  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a, searchGeneration: 1 }, registry.checkLive)
  const room = await matchmaker.reserveMatch({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b, searchGeneration: 1 }, registry.checkLive)
  assert.ok(room)

  // Delete the reservation instead of committing it — simulates
  // server/ws-server.ts's final pre-commit check failing (e.g. a socket
  // closed during the Friends lookup) — and requeue both, exactly like
  // ws-server.ts's own rollback path does for any side that's still live.
  matchmaker.deleteReservation(room!.id)
  assert.equal(matchmaker.getRoom(room!.id), undefined, "room mapping fully removed")
  matchmaker.requeue({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b, searchGeneration: 1 })

  // If a cooldown HAD been recorded, these two (still opposite gender,
  // b freshly re-queued) would skip each other and `a` would just end up
  // queued again instead of matching. Since nothing was ever committed,
  // they must be able to reserve together again immediately.
  const secondAttempt = await matchmaker.reserveMatch(
    { userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a, searchGeneration: 1 },
    registry.checkLive
  )
  assert.ok(secondAttempt, "no cooldown from the deleted reservation — they can match now")
  assert.equal(secondAttempt!.b, b)
})

test("committing a match DOES record the recent-partner cooldown — the same pair can't immediately re-match", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const a = uid("m")
  const b = uid("f")
  registry.register(a, { gender: "male", searchGeneration: 1 })
  registry.register(b, { gender: "female", searchGeneration: 1 })

  await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a, searchGeneration: 1 }, registry.checkLive)
  const room = await matchmaker.reserveMatch({ userId: b, gender: "female", enqueuedAt: Date.now(), debugId: b, searchGeneration: 1 }, registry.checkLive)
  assert.ok(room)
  // Only after commit does this pair count as "recent" — mirrors
  // ws-server.ts's tryMatch, which calls this only after both "matched"
  // sends have gone out to confirmed-OPEN sockets.
  matchmaker.commitMatch(room!.id)

  // Both leave their (simulated) call and immediately try to find someone
  // new — but there's a third account, `c`, also opposite-gender to `a`,
  // waiting. `a` and `b` must not be offered to each other again; `a` and
  // `c` must still be able to match.
  matchmaker.leaveRoom(a)
  matchmaker.leaveRoom(b)
  registry.conns.get(a)!.roomId = null
  registry.conns.get(b)!.roomId = null
  const c = uid("f")
  registry.register(c, { gender: "female", searchGeneration: 1 })
  await matchmaker.reserveMatch({ userId: c, gender: "female", enqueuedAt: Date.now(), debugId: c, searchGeneration: 1 }, registry.checkLive)
  const rematch = await matchmaker.reserveMatch({ userId: a, gender: "male", enqueuedAt: Date.now(), debugId: a, searchGeneration: 1 }, registry.checkLive)
  assert.ok(rematch, "a matches someone")
  assert.equal(rematch!.b, c, "a matched c, not b — the recent-partner cooldown correctly kept b out of consideration")
})

// Test 9 — gender changes while queued: reserveMatch always removes the
// caller's own prior queue entry first, so re-calling it with an updated
// gender is exactly how ws-server re-evaluates a queued account after a
// profile-update (see server/ws-server.ts's "profile-update" handler).
test("re-reserving with a changed gender replaces the old queue snapshot — matching uses the NEW gender only", async () => {
  const matchmaker = new Matchmaker()
  const registry = makeRegistry()
  const changer = uid("switcher")
  const maleCandidate = uid("m")
  registry.register(changer, { gender: "male", searchGeneration: 1 })
  registry.register(maleCandidate, { gender: "male", searchGeneration: 1 })

  // Queued as male first.
  await matchmaker.reserveMatch({ userId: changer, gender: "male", enqueuedAt: Date.now(), debugId: changer, searchGeneration: 1 }, registry.checkLive)

  // A male candidate arrives — must NOT match (changer is currently "male" too).
  const shouldNotMatch = await matchmaker.reserveMatch(
    { userId: maleCandidate, gender: "male", enqueuedAt: Date.now(), debugId: maleCandidate, searchGeneration: 1 },
    registry.checkLive
  )
  assert.equal(shouldNotMatch, null, "still both male at this point")
  assert.equal(matchmaker.queueSize, 2)

  // Now `changer` switches to female and re-reserves (mirrors the
  // gender-changed-while-queued path) — this removes the stale male queue
  // entry and re-adds as female. The registry's own record of `changer`
  // must reflect the new gender too, matching what checkLive would report.
  registry.conns.get(changer)!.gender = "female"
  const afterGenderChange = await matchmaker.reserveMatch(
    { userId: changer, gender: "female", enqueuedAt: Date.now(), debugId: changer, searchGeneration: 1 },
    registry.checkLive
  )
  // maleCandidate is still queued (male), changer is now female -> opposite genders -> should match immediately.
  assert.ok(afterGenderChange, "changer (now female) immediately matches the waiting male candidate")
  assert.equal(afterGenderChange!.b, maleCandidate)
})
