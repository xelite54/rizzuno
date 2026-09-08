import { test } from "node:test"
import assert from "node:assert/strict"
import { decideConnectionRecoveryAction, decideAfterIceRecoveryDeadline } from "../lib/webrtcRecovery"

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
