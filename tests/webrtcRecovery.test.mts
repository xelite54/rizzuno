import { test } from "node:test"
import assert from "node:assert/strict"
import { decideConnectionRecoveryAction } from "../lib/webrtcRecovery"

// decideConnectionRecoveryAction — the grace-window + one-shot-recovery
// decision: `failed` recovers immediately (nothing to wait out — a
// terminal ICE state), `disconnected` gets a short grace window first (the
// exact state a brief Wi-Fi hiccup produces on its own, often
// self-resolving), `connected` clears any pending grace timer, anything
// else is a no-op — UNLESS the one allowed restart for the current problem
// has already been used (`recoveryUsed`), in which case a further
// disconnected/failed report is the SAME still-unresolved problem showing
// up again, never a fresh one worth another attempt: terminate instead.

test("failed recovers immediately, when recovery hasn't been used yet", () => {
  assert.equal(decideConnectionRecoveryAction("failed", false), "recover-now")
})

test("disconnected gets a grace window before recovering, never immediately", () => {
  assert.equal(decideConnectionRecoveryAction("disconnected", false), "grace-then-recover")
})

test("connected clears any pending grace timer, regardless of whether recovery was ever used", () => {
  assert.equal(decideConnectionRecoveryAction("connected", false), "clear-grace")
  assert.equal(decideConnectionRecoveryAction("connected", true), "clear-grace")
})

test("any other state is a no-op, regardless of whether recovery was ever used", () => {
  assert.equal(decideConnectionRecoveryAction("other", false), "none")
  assert.equal(decideConnectionRecoveryAction("other", true), "none")
})

test("failed with the one allowed restart already used terminates instead of retrying — never loop", () => {
  assert.equal(decideConnectionRecoveryAction("failed", true), "terminate")
})

test("disconnected with the one allowed restart already used terminates instead of another grace window — never loop", () => {
  assert.equal(decideConnectionRecoveryAction("disconnected", true), "terminate")
})
