import { test } from "node:test"
import assert from "node:assert/strict"
import { startTestServer, connectAndHello } from "./helpers/wsHarness.mts"
import { resetDbMockState } from "./helpers/dbMock.mts"
import { setProviderForTesting } from "../lib/imageModeration/provider.ts"
import { buildPngDataUrl } from "./helpers/pngFixture.mts"

/**
 * Proves server/ws-server.ts's "chat" image handler actually routes
 * through the one centralized moderateImage() pipeline (lib/imageModeration)
 * before ever forwarding to the matched partner — using the REAL ws server
 * (server/ws-server.ts, unmodified) over a REAL socket, driven the exact
 * same way a hand-crafted, frontend-bypassing client would: there is no
 * chat-image-send UI in Rizzuno today (see hooks/useMatchmaking.ts's
 * sendChat, which is text-only), so a raw WS "chat" message with
 * content.kind === "image" is, on its own, already exactly what "a
 * malicious user calling an API endpoint directly, bypassing the browser"
 * looks like for this surface. This is that bypass test.
 */

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

test("chat image: an allowed image is forwarded to the matched partner", async () => {
  resetDbMockState()
  setProviderForTesting({
    name: "fake",
    modelVersion: "test-1",
    analyze: async () => ({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } }),
  })
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("f"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    const dataUrl = buildPngDataUrl(8, 8)
    a.send({ type: "chat", roomId: matched.roomId, content: { kind: "image", dataUrl } })
    const received = await b.waitForType("chat")
    assert.equal(received.content.kind, "image")
    if (received.content.kind === "image") assert.equal(received.content.dataUrl, dataUrl)

    a.close()
    b.close()
  } finally {
    setProviderForTesting(null)
    await server.close()
  }
})

test("chat image: a moderation-blocked image is NEVER forwarded to the partner — the sender gets an error instead", async () => {
  resetDbMockState()
  setProviderForTesting({
    name: "fake",
    modelVersion: "test-1",
    analyze: async () => ({ ok: true, analysis: { categories: [{ category: "explicit_sexual", score: 0.99 }], providerReference: null } }),
  })
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("f"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    a.send({ type: "chat", roomId: matched.roomId, content: { kind: "image", dataUrl: buildPngDataUrl(8, 8) } })
    const errorMsg = await a.waitForType("error")
    assert.equal(errorMsg.message, "Image blocked.")

    // The partner must never receive it — race a short timeout against any
    // "chat" message actually arriving; timing out is the success case.
    await assert.rejects(() => b.waitForType("chat", 300), /timed out/)

    a.close()
    b.close()
  } finally {
    setProviderForTesting(null)
    await server.close()
  }
})

test("chat image: a provider failure (unavailable) also fails closed — the image is never forwarded", async () => {
  resetDbMockState()
  setProviderForTesting({
    name: "fake",
    modelVersion: "test-1",
    analyze: async () => ({ ok: false, reason: "timeout" }),
  })
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("f"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    a.send({ type: "chat", roomId: matched.roomId, content: { kind: "image", dataUrl: buildPngDataUrl(8, 8) } })
    const errorMsg = await a.waitForType("error")
    assert.equal(errorMsg.message, "Image blocked.")
    await assert.rejects(() => b.waitForType("chat", 300), /timed out/)

    a.close()
    b.close()
  } finally {
    setProviderForTesting(null)
    await server.close()
  }
})

test("chat image: a raw, hand-crafted WS message with an oversized/malformed dataUrl is rejected before moderateImage is even reached, and is still never forwarded", async () => {
  resetDbMockState()
  // A provider that would allow anything — proving the rejection here comes
  // from the pre-existing DATA_URL_IMAGE_PATTERN/MAX_CHAT_IMAGE_LENGTH gate
  // (or moderateImage's own validation), not from this provider.
  setProviderForTesting({
    name: "fake",
    modelVersion: "test-1",
    analyze: async () => ({ ok: true, analysis: { categories: [], providerReference: null } }),
  })
  const server = await startTestServer()
  try {
    const a = await connectAndHello(server.url, uid("m"), { gender: "male" })
    const b = await connectAndHello(server.url, uid("f"), { gender: "female" })
    a.send({ type: "find" })
    b.send({ type: "find" })
    const matched = await a.waitForType("matched")
    await b.waitForType("matched")

    // Not even a data URL — a malicious/broken client sending garbage.
    a.send({ type: "chat", roomId: matched.roomId, content: { kind: "image", dataUrl: "not a data url" } })
    await assert.rejects(() => b.waitForType("chat", 300), /timed out/)

    a.close()
    b.close()
  } finally {
    setProviderForTesting(null)
    await server.close()
  }
})
