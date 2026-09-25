import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { __flushCurrentPhotos, __resetCurrentPhotos, knownPhoto, primeCurrentPhoto, requestCurrentPhoto, STALE_MS, subscribeCurrentPhotos } from "../lib/currentPhotos.ts"
import { realtimePhotoSignal } from "../lib/publicProfile.ts"

const fresh = "/api/media/22222222-2222-4222-8222-222222222222.webp"
let now = 1_000
let calls: string[] = []
let answer: Record<string, string | null> = {}
let fail = false
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  now = 1_000; calls = []; answer = {}; fail = false
  __resetCurrentPhotos({
    clock: () => now,
    fetcher: async (url) => {
      calls.push(url)
      if (fail) throw new Error("offline")
      return new Response(JSON.stringify({ photos: answer }))
    },
  })
})

test("lookups in the same tick share one batched request", async () => {
  answer = { alpha: fresh, bravo: null }
  requestCurrentPhoto("Alpha"); requestCurrentPhoto("bravo"); requestCurrentPhoto("alpha")
  await settle(); await settle()
  assert.equal(calls.length, 1)
  assert.equal(calls[0], "/api/profile/photos?u=alpha&u=bravo")
  assert.equal(knownPhoto("alpha"), fresh)
  assert.equal(knownPhoto("bravo"), null, "no photo → initial")
})

test("unknown until answered, so the caller's snapshot is only a placeholder", async () => {
  assert.equal(knownPhoto("alpha"), undefined)
  answer = {} // absent = not visible (blocked/banned/…) → no photo, even if a snapshot had one
  requestCurrentPhoto("alpha")
  await settle(); await settle()
  assert.equal(knownPhoto("alpha"), null)
})

test("fresh answers are reused, stale ones re-checked (a changed photo shows on refresh)", async () => {
  answer = { alpha: "/api/media/old.webp" }
  requestCurrentPhoto("alpha"); await settle(); await settle()
  requestCurrentPhoto("alpha"); await settle()
  assert.equal(calls.length, 1)
  now += STALE_MS + 1
  answer = { alpha: fresh }
  requestCurrentPhoto("alpha"); await settle(); await settle()
  assert.equal(calls.length, 2)
  assert.equal(knownPhoto("alpha"), fresh)
})

test("server data from other sources primes the store and notifies avatars", async () => {
  let notified = 0
  const stop = subscribeCurrentPhotos(() => { notified++ })
  primeCurrentPhoto("alpha", fresh)
  primeCurrentPhoto("alpha", fresh)
  primeCurrentPhoto("alpha", null)
  stop()
  assert.equal(notified, 2, "only real changes re-render")
  assert.equal(knownPhoto("alpha"), null)
  requestCurrentPhoto("alpha"); await settle()
  assert.equal(calls.length, 0, "a primed answer is fresh")
})

test("a network failure leaves the snapshot in place instead of blanking avatars", async () => {
  fail = true
  requestCurrentPhoto("alpha")
  await __flushCurrentPhotos(); await settle()
  assert.equal(knownPhoto("alpha"), undefined)
})

test("realtime frames never carry image data", () => {
  assert.equal(realtimePhotoSignal(null), null)
  assert.equal(realtimePhotoSignal(fresh), fresh)
  const big = "data:image/webp;base64," + "A".repeat(3_000_000)
  const signal = realtimePhotoSignal(big)!
  assert.ok(signal.length < 64 && signal.startsWith("local:"))
  assert.equal(realtimePhotoSignal(big), signal, "stable, so unchanged photos send no update")
  assert.notEqual(realtimePhotoSignal(big + "B"), signal, "a different photo is a change")
})
