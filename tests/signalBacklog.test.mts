import { test } from "node:test"
import assert from "node:assert/strict"
import { SignalBacklog, MAX_BUFFERED_SIGNALS_PER_ROOM } from "../lib/signalBacklog"
import type { RtcSignal } from "../lib/signaling/protocol"

// Test 8 — "offer arrives before useWebRTC listener → stored → delivered".
test("signal arriving before a listener subscribes is buffered, then delivered in order once one does", () => {
  const backlog = new SignalBacklog()
  const offer: RtcSignal = { kind: "offer", sdp: "offer-sdp" }
  const ice1: RtcSignal = { kind: "ice", candidate: { candidate: "candidate-1" } }
  const ice2: RtcSignal = { kind: "ice", candidate: { candidate: "candidate-2" } }

  backlog.push("room-1", offer)
  backlog.push("room-1", ice1)
  backlog.push("room-1", ice2)
  assert.equal(backlog.sizeFor("room-1"), 3, "nothing delivered yet — still buffered")

  const delivered: { roomId: string; signal: RtcSignal }[] = []
  backlog.drainAll((roomId, signal) => delivered.push({ roomId, signal }))

  assert.deepEqual(
    delivered.map((d) => d.signal),
    [offer, ice1, ice2],
    "delivered in the exact order they arrived — offer first, then ICE candidates"
  )
  assert.equal(backlog.sizeFor("room-1"), 0, "drained — nothing left buffered after delivery")
})

test("drainAll replays every room's backlog, letting the (self-filtering) handler sort out which it wants", () => {
  const backlog = new SignalBacklog()
  backlog.push("room-a", { kind: "offer", sdp: "a" })
  backlog.push("room-b", { kind: "offer", sdp: "b" })

  const seenRooms: string[] = []
  backlog.drainAll((roomId) => seenRooms.push(roomId))

  assert.deepEqual(new Set(seenRooms), new Set(["room-a", "room-b"]))
})

test("clear(roomId) discards only that room's backlog, leaving others intact", () => {
  const backlog = new SignalBacklog()
  backlog.push("room-a", { kind: "ice", candidate: {} })
  backlog.push("room-b", { kind: "ice", candidate: {} })

  backlog.clear("room-a")

  assert.equal(backlog.sizeFor("room-a"), 0)
  assert.equal(backlog.sizeFor("room-b"), 1)
})

test("clearAll() wipes every room's backlog", () => {
  const backlog = new SignalBacklog()
  backlog.push("room-a", { kind: "ice", candidate: {} })
  backlog.push("room-b", { kind: "ice", candidate: {} })

  backlog.clearAll()

  assert.equal(backlog.sizeFor("room-a"), 0)
  assert.equal(backlog.sizeFor("room-b"), 0)
})

test("a room's backlog is capped — the oldest signal is dropped, not the newest, once full", () => {
  const backlog = new SignalBacklog()
  for (let i = 0; i < MAX_BUFFERED_SIGNALS_PER_ROOM + 10; i++) {
    backlog.push("room-1", { kind: "ice", candidate: { candidate: `candidate-${i}` } })
  }

  assert.equal(backlog.sizeFor("room-1"), MAX_BUFFERED_SIGNALS_PER_ROOM, "never exceeds the cap")

  const delivered: RtcSignal[] = []
  backlog.drainAll((_roomId, signal) => delivered.push(signal))
  const firstCandidate = delivered[0]
  assert.equal(firstCandidate.kind, "ice")
  assert.equal(
    firstCandidate.kind === "ice" ? firstCandidate.candidate.candidate : null,
    "candidate-10",
    "the oldest 10 were dropped to stay at the cap — the newest signals survive"
  )
})
