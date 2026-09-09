import { test } from "node:test"
import assert from "node:assert/strict"
import { decideConnectionRecoveryAction, decideAfterIceRecoveryDeadline, nextBytesReadyStreak, BYTES_READY_STREAK_TICKS } from "../lib/webrtcRecovery"

// decideConnectionRecoveryAction — the grace-window decision: `failed`
// recovers immediately (nothing to wait out — a terminal ICE state),
// `disconnected` gets a short grace window first (the exact state a brief
// Wi-Fi hiccup produces on its own, often self-resolving), `connected`
// clears any pending grace timer, anything else is a no-op.
test("failed recovers immediately", () => {
  assert.equal(decideConnectionRecoveryAction("failed"), "recover-now")
})

test("disconnected gets a grace window before recovering, never immediately", () => {
  assert.equal(decideConnectionRecoveryAction("disconnected"), "grace-then-recover")
})

test("connected clears any pending grace timer", () => {
  assert.equal(decideConnectionRecoveryAction("connected"), "clear-grace")
})

test("any other state is a no-op", () => {
  assert.equal(decideConnectionRecoveryAction("other"), "none")
})

// decideAfterIceRecoveryDeadline — bounds the fresh-RTCPeerConnection
// recovery tier to exactly one attempt per room, ever.
test("the bounded ICE restart failing to resolve in time gets exactly one fresh-connection recovery, the first time", () => {
  assert.equal(decideAfterIceRecoveryDeadline(false), "attempt-fresh-connection")
})

test("a SECOND ICE-restart-deadline exceeded (the fresh connection's own) gives up instead of trying another fresh connection", () => {
  assert.equal(decideAfterIceRecoveryDeadline(true), "give-up")
})

// nextBytesReadyStreak — the third readiness proof's own running counter:
// real, monotonically growing inbound bytesReceived over several
// consecutive ticks, independent of framesDecoded or a <video> element ever
// reaching "playing". Only ever a fallback for when the other two proofs
// never resolve at all — see its own doc comment for the exact gap it
// exists to close.
test("strictly increasing bytes extends the streak, one tick at a time", () => {
  let streak = 0
  streak = nextBytesReadyStreak(1000, 1500, streak)
  assert.equal(streak, 1)
  streak = nextBytesReadyStreak(1500, 2200, streak)
  assert.equal(streak, 2)
})

test("bytes that stop growing (a real stall, not just 'hasn't grown yet') resets the streak to zero", () => {
  assert.equal(nextBytesReadyStreak(2200, 2200, 4), 0, "unchanged bytes — no real progress this tick")
  assert.equal(nextBytesReadyStreak(2200, 2100, 4), 0, "bytes can't legitimately go DOWN on a cumulative counter — treat it as a reset, not negative progress")
})

test("a null reading (no stats yet, or the very first tick with nothing to compare against) never counts as progress", () => {
  assert.equal(nextBytesReadyStreak(null, 1000, 0), 0, "nothing to compare the first real reading against yet")
  assert.equal(nextBytesReadyStreak(1000, null, 3), 0, "a missing current reading must reset, never silently preserve an old streak")
})

test("sustaining growth for BYTES_READY_STREAK_TICKS consecutive ticks is exactly what useWebRTC.ts treats as proof — never fewer, never a single burst", () => {
  let streak = 0
  let bytes: number | null = 1000
  for (let i = 0; i < BYTES_READY_STREAK_TICKS - 1; i++) {
    const next: number = bytes! + 500
    streak = nextBytesReadyStreak(bytes, next, streak)
    bytes = next
  }
  assert.equal(streak, BYTES_READY_STREAK_TICKS - 1, "one tick short of the threshold — not ready yet")
  streak = nextBytesReadyStreak(bytes, bytes! + 500, streak)
  assert.equal(streak, BYTES_READY_STREAK_TICKS)
})
