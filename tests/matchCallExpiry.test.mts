import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { resetDbMockState } from "./helpers/dbMock.mts"
import { roomCallTestConfig } from "../server/ws-server"
import { MATCH_CALL_LIMIT_MS } from "../lib/matchCallLimit"

test("a match stays open before its deadline and expires for both people despite renegotiation", async () => {
  resetDbMockState()
  assert.equal(roomCallTestConfig.limitMs, MATCH_CALL_LIMIT_MS)
  roomCallTestConfig.limitMs = 500
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "expiry-a", { gender: "male" })
    const b = await connectAndHello(server.url, "expiry-b", { gender: "female" })
    a.send({ type: "find" }); b.send({ type: "find" })
    const am = await a.waitForType("matched")
    const bm = await b.waitForType("matched")
    assert.equal(am.expiresAt, bm.expiresAt)
    assert.equal(am.expiresAt! - am.serverNow!, 500)
    a.send({ type: "signal", roomId: am.roomId, data: { kind: "offer", sdp: "initial" } })
    await b.waitForType("signal")
    await assert.rejects(() => a.waitForType("peer-left", 100), /timed out/)
    a.send({ type: "signal", roomId: am.roomId, data: { kind: "offer", sdp: "restart" } })
    await b.waitForType("signal")
    assert.equal((await a.waitForType("peer-left")).roomId, am.roomId)
    assert.equal((await b.waitForType("peer-left")).roomId, am.roomId)
    // Both sides can resume through the normal peer-left flow.
    a.send({ type: "find" })
    await a.waitForType("queued")
    a.close(); b.close()
  } finally {
    roomCallTestConfig.limitMs = MATCH_CALL_LIMIT_MS
    await server.close()
  }
})

test("skipping cancels the previous timer and gives the next person a fresh deadline", async () => {
  resetDbMockState()
  roomCallTestConfig.limitMs = 200
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, "skip-limit-a", { gender: "male" })
    const b = await connectAndHello(server.url, "skip-limit-b", { gender: "female" })
    a.send({ type: "find" }); b.send({ type: "find" })
    const first = await a.waitForType("matched")
    await b.waitForType("matched")
    roomCallTestConfig.limitMs = 800
    a.send({ type: "skip" })
    await b.waitForType("peer-left")
    await a.waitForType("queued")
    const c = await connectAndHello(server.url, "skip-limit-c", { gender: "female" })
    c.send({ type: "find" })
    const next = await a.waitForType("matched")
    await c.waitForType("matched")
    assert.notEqual(first.roomId, next.roomId)
    assert.equal(next.expiresAt! - next.serverNow!, 800)
    await assert.rejects(() => a.waitForType("peer-left", 300), /timed out/)
    // Explicit Stop also cancels the current expiry timer.
    a.send({ type: "leave" })
    await c.waitForType("peer-left")
    await assert.rejects(() => a.waitForType("peer-left", 600), /timed out/)
    a.close(); b.close(); c.close()
  } finally {
    roomCallTestConfig.limitMs = MATCH_CALL_LIMIT_MS
    await server.close()
  }
})
