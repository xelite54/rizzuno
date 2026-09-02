import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { buildPngDataUrl } from "./helpers/pngFixture.mts"

/**
 * An in-memory stand-in for the moderation_events table (lib/db.ts's
 * recordModerationEvent/getCachedModerationDecision/
 * countRecentBlockedUploads) — real enough that a cache hit here is a
 * genuine round trip through this fake store, not a canned response, so
 * "duplicate approved image reuses the cache" is actually proven rather
 * than assumed. Reset per test via resetFakeDb() so tests never leak
 * moderation history into each other (this module is only ever registered
 * once for the whole process — see mock.module() below).
 */
type FakeEvent = {
  id: string
  userId: string
  surface: string
  imageHash: string
  decision: "allow" | "review" | "block"
  categories: { category: string; score: number }[]
  provider: string
  providerReference: string | null
  policyVersion: string
  providerModelVersion: string
  createdAt: number
}

let events: FakeEvent[] = []
let nextId = 1
let recordCount = 0
// A minimal in-memory stand-in for image_moderation_rate_limits — keyed
// the same way the real fixed-window counter is (userId+surface), but
// without real window-expiry semantics, since no test here needs a check
// to actually roll over into a new window; resetFakeDb() clears it the
// same as the moderation-events store above.
let rateLimitCounts = new Map<string, number>()

function resetFakeDb() {
  events = []
  nextId = 1
  recordCount = 0
  rateLimitCounts = new Map()
}

mock.module("@/lib/db", {
  exports: {
    recordModerationEvent: async (event: Omit<FakeEvent, "id" | "createdAt">) => {
      recordCount += 1
      const id = `mod-${nextId++}`
      events.push({ ...event, id, createdAt: Date.now() })
      return id
    },
    getCachedModerationDecision: async (imageHash: string, policyVersion: string, providerModelVersion: string) => {
      const matches = events
        .filter((e) => e.imageHash === imageHash && e.policyVersion === policyVersion && e.providerModelVersion === providerModelVersion)
        .sort((a, b) => b.createdAt - a.createdAt)
      if (matches.length === 0) return null
      const match = matches[0]
      return { ...match, moderationId: match.id }
    },
    countRecentBlockedUploads: async (userId: string, sinceMs: number, categoryFilter?: string[]) =>
      events.filter(
        (e) =>
          e.userId === userId &&
          e.decision === "block" &&
          e.createdAt >= sinceMs &&
          (!categoryFilter || e.categories.some((c) => categoryFilter.includes(c.category)))
      ).length,
    checkAndIncrementImageModerationRateLimit: async (userId: string, surface: string, limit: number) => {
      const key = `${userId}:${surface}`
      const count = (rateLimitCounts.get(key) ?? 0) + 1
      rateLimitCounts.set(key, count)
      return count > limit
    },
  },
})

// mock.module() must be registered (above) before lib/imageModeration/
// index.ts (or anything importing it) is ever loaded anywhere in this
// process — dynamic import here, not a top-level one, preserves that
// ordering the same way tests/matchmaker.test.mts's own comment explains.
const { moderateImage } = await import("../lib/imageModeration/index.ts")
const { setProviderForTesting } = await import("../lib/imageModeration/provider.ts")
import type { ProviderOutcome } from "../lib/imageModeration/provider.ts"

let counter = 0
function uid(label: string): string {
  counter += 1
  return `${label}-${counter}`
}

/** A fully-controllable fake provider — counts calls so cache-reuse can be proven by asserting it was NOT called again, not just by asserting the right decision came back. */
function makeFakeProvider(outcome: ProviderOutcome) {
  let calls = 0
  return {
    provider: {
      name: "fake",
      modelVersion: "test-1",
      analyze: async () => {
        calls += 1
        return outcome
      },
    },
    get calls() {
      return calls
    },
  }
}

test("moderateImage: a normal image with no flagged categories is allowed", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: "ref-1" } })
  setProviderForTesting(fake.provider)
  try {
    const result = await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "post" })
    assert.equal(result.decision, "allow")
    assert.equal(fake.calls, 1)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: explicit nudity is blocked and never reaches an allow decision", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.95 }], providerReference: "ref-2" } })
  setProviderForTesting(fake.provider)
  try {
    const result = await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "profile_photo" })
    assert.equal(result.decision, "block")
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: gore is blocked", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "gore", score: 0.9 }], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const result = await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "post" })
    assert.equal(result.decision, "block")
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: a provider timeout/error fails CLOSED — block, unavailable:true, never interpreted as safe", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: false, reason: "timeout" })
  setProviderForTesting(fake.provider)
  try {
    const result = await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "post" })
    assert.equal(result.decision, "block")
    assert.equal(result.unavailable, true)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: an unconfigured provider (the real out-of-the-box default — see provider.ts's UnconfiguredProvider) also fails closed", async () => {
  resetFakeDb()
  setProviderForTesting(null) // forces getConfiguredProvider() to fall through to its real env-based selection, which in this test environment has no IMAGE_MODERATION_PROVIDER_URL/API_KEY set
  const before = { ...process.env }
  delete process.env.IMAGE_MODERATION_PROVIDER_URL
  delete process.env.IMAGE_MODERATION_API_KEY
  try {
    const result = await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "post" })
    assert.equal(result.decision, "block")
    assert.equal(result.unavailable, true)
  } finally {
    process.env = before
  }
})

test("moderateImage: a provider failure never writes a moderation_events row — infra failures don't count toward abuse escalation", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: false, reason: "error" })
  setProviderForTesting(fake.provider)
  try {
    await moderateImage({ userId: uid("user"), dataUrl: buildPngDataUrl(8, 8), surface: "post" })
    assert.equal(recordCount, 0)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: the exact same normalized image bytes reuse the cached decision — no second provider call", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: "ref-3" } })
  setProviderForTesting(fake.provider)
  try {
    const user = uid("user")
    const dataUrl = buildPngDataUrl(16, 16)
    const first = await moderateImage({ userId: user, dataUrl, surface: "post" })
    const second = await moderateImage({ userId: user, dataUrl, surface: "post" })
    assert.equal(first.decision, "allow")
    assert.equal(second.decision, "allow")
    assert.equal(fake.calls, 1, "the provider should only ever have been called once for the exact same bytes")
    assert.equal(recordCount, 2, "each attempt still gets its own moderation_events row, cache hit or not")
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: a different image (different bytes) never reuses another image's cached decision", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const user = uid("user")
    await moderateImage({ userId: user, dataUrl: buildPngDataUrl(16, 16), surface: "post" })
    await moderateImage({ userId: user, dataUrl: buildPngDataUrl(20, 20), surface: "post" })
    assert.equal(fake.calls, 2)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: validation failure (not a real image) is rejected without ever calling the provider", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const fakeBytes = Buffer.from("not an image")
    const dataUrl = `data:image/png;base64,${fakeBytes.toString("base64")}`
    const result = await moderateImage({ userId: uid("user"), dataUrl, surface: "post" })
    assert.equal(result.decision, "block")
    assert.equal(fake.calls, 0)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: rate limiting blocks further uploads on the same surface for the same account once the limit is exceeded, independent of content", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const user = uid("user")
    // profile_photo's limit is 10/hour (see lib/imageModeration/index.ts's
    // RATE_LIMITS) — drive it well past that with distinct images each
    // time (so the cache is never what's blocking these).
    let lastResult
    for (let i = 0; i < 12; i++) {
      lastResult = await moderateImage({ userId: user, dataUrl: buildPngDataUrl(16 + i, 16 + i), surface: "profile_photo" })
    }
    assert.equal(lastResult?.decision, "block")
    assert.equal(lastResult?.unavailable, true)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: a rate-limit rejection never writes a moderation_events row", async () => {
  resetFakeDb()
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const user = uid("user")
    for (let i = 0; i < 11; i++) {
      await moderateImage({ userId: user, dataUrl: buildPngDataUrl(16 + i, 16 + i), surface: "profile_photo" })
    }
    // The first 10 each recorded a real (allowed) event; the 11th was rate-limited and recorded nothing.
    assert.equal(recordCount, 10)
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: three blocked uploads (a non-severe category) within the escalation window restrict further uploads for that account, even a normally-safe one", async () => {
  resetFakeDb()
  // hate_extremist is deliberately NOT one of abuse.ts's SEVERE_CATEGORIES
  // — this is specifically testing the general 3-strikes pattern, not the
  // separate 1-strike severe-category rule (see the next test).
  const blocking = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "hate_extremist", score: 0.9 }], providerReference: null } })
  setProviderForTesting(blocking.provider)
  const user = uid("user")
  try {
    for (let i = 0; i < 3; i++) {
      const r = await moderateImage({ userId: user, dataUrl: buildPngDataUrl(30 + i, 30 + i), surface: "post" })
      assert.equal(r.decision, "block")
    }
  } finally {
    setProviderForTesting(null)
  }
  // A 4th attempt, now with a provider that would otherwise allow it —
  // the account should be restricted from the abuse pattern alone.
  const safe = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } })
  setProviderForTesting(safe.provider)
  try {
    const result = await moderateImage({ userId: user, dataUrl: buildPngDataUrl(99, 99), surface: "post" })
    assert.equal(result.decision, "block")
    assert.equal(safe.calls, 0, "the abuse restriction should reject before ever calling the provider")
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: a single severe-category block (gore/exposed organs/csam_suspected) restricts immediately — no need to wait for a 3-strike pattern", async () => {
  resetFakeDb()
  const blocking = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "gore", score: 0.9 }], providerReference: null } })
  setProviderForTesting(blocking.provider)
  const user = uid("user")
  try {
    const first = await moderateImage({ userId: user, dataUrl: buildPngDataUrl(40, 40), surface: "post" })
    assert.equal(first.decision, "block")
  } finally {
    setProviderForTesting(null)
  }
  const safe = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "nudity", score: 0.01 }], providerReference: null } })
  setProviderForTesting(safe.provider)
  try {
    const result = await moderateImage({ userId: user, dataUrl: buildPngDataUrl(41, 41), surface: "post" })
    assert.equal(result.decision, "block")
    assert.equal(safe.calls, 0, "restricted immediately after one severe-category block — the provider is never even called")
  } finally {
    setProviderForTesting(null)
  }
})

test("moderateImage: a direct call bypassing any UI — exactly what a malicious client hitting the API/WS route directly would produce — is moderated exactly the same as a normal upload", async () => {
  resetFakeDb()
  // No route, no client-side check, nothing — this call is indistinguishable from what a hand-crafted, frontend-bypassing request to app/api/profile/posts or the WS 'chat' handler would produce: moderateImage() is the only thing standing between it and being persisted/forwarded, and it applies the exact same policy either way.
  const fake = makeFakeProvider({ ok: true, analysis: { categories: [{ category: "explicit_sexual", score: 0.99 }], providerReference: null } })
  setProviderForTesting(fake.provider)
  try {
    const result = await moderateImage({ userId: uid("attacker"), dataUrl: buildPngDataUrl(8, 8), surface: "chat" })
    assert.equal(result.decision, "block")
  } finally {
    setProviderForTesting(null)
  }
})
