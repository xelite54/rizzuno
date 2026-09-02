import { test } from "node:test"
import assert from "node:assert/strict"
import { __test__, SightengineProvider } from "../lib/imageModeration/sightengineProvider.ts"

const { mapSightengineResponseToCategories, parseSightengineResponse } = __test__

/**
 * Fixtures below are shaped exactly as Sightengine's own published
 * documentation shows for each model (nudity-2.1, gore, violence, weapon,
 * recreational_drug, medical, offensive) — see
 * lib/imageModeration/sightengineProvider.ts's own doc comment for the
 * exact mapping this proves, without needing a real network call or real
 * credentials.
 */

function scoreOf(categories: { category: string; score: number }[], category: string): number | undefined {
  return categories.find((c) => c.category === category)?.score
}

const SAFE_NUDITY = {
  sexual_activity: 0.01,
  sexual_display: 0.01,
  erotica: 0.01,
  very_suggestive: 0.01,
  suggestive: 0.01,
  mildly_suggestive: 0.01,
  none: 0.99,
  suggestive_classes: { visibly_undressed: 0.01 },
  context: {},
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    request: { id: "req_test123", timestamp: 1, operations: 1 },
    nudity: SAFE_NUDITY,
    gore: { prob: 0.01 },
    violence: { prob: 0.01, classes: { physical_violence: 0.01, firearm_threat: 0.01, combat_sport: 0.01 } },
    weapon: {
      classes: { firearm: 0.01, firearm_gesture: 0.01, firearm_toy: 0.01, knife: 0.01 },
      firearm_type: {},
      firearm_action: {},
    },
    recreational_drug: { prob: 0.01, classes: {} },
    medical: { prob: 0.01, classes: {} },
    offensive: { prob: 0.01, nazi: 0.01, confederate: 0.01, supremacist: 0.01, terrorist: 0.01, middle_finger: 0.01, boxes: [] },
    media: { id: "med_test123", uri: "https://example.com/test.jpg" },
    ...overrides,
  }
}

test("mapSightengineResponseToCategories: an entirely safe response scores every category near zero", () => {
  const categories = mapSightengineResponseToCategories(fixture())
  assert.ok(categories)
  for (const { score } of categories!) assert.ok(score <= 0.05, `expected a near-zero score, got ${score}`)
})

test("mapSightengineResponseToCategories: sexual_activity/sexual_display drive explicit_sexual", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ nudity: { ...SAFE_NUDITY, sexual_activity: 0.97 } })
  )!
  assert.equal(scoreOf(categories, "explicit_sexual"), 0.97)
})

test("mapSightengineResponseToCategories: very_suggestive/suggestive drive suggestive_sexual, not explicit_sexual", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ nudity: { ...SAFE_NUDITY, very_suggestive: 0.8 } })
  )!
  assert.equal(scoreOf(categories, "suggestive_sexual"), 0.8)
  assert.ok((scoreOf(categories, "explicit_sexual") ?? 0) < 0.1)
})

test("mapSightengineResponseToCategories: erotica drives nudity", () => {
  const categories = mapSightengineResponseToCategories(fixture({ nudity: { ...SAFE_NUDITY, erotica: 0.85 } }))!
  assert.equal(scoreOf(categories, "nudity"), 0.85)
})

test("mapSightengineResponseToCategories: gore.prob drives BOTH gore and graphic_violence from the same signal", () => {
  const categories = mapSightengineResponseToCategories(fixture({ gore: { prob: 0.92 } }))!
  assert.equal(scoreOf(categories, "gore"), 0.92)
  assert.equal(scoreOf(categories, "graphic_violence"), 0.92)
})

test("mapSightengineResponseToCategories: severe_injury/exposed_organs_dismemberment/disturbing_dead_bodies are never fabricated from gore — Sightengine doesn't distinguish them", () => {
  const categories = mapSightengineResponseToCategories(fixture({ gore: { prob: 0.99 } }))!
  assert.equal(scoreOf(categories, "severe_injury"), undefined)
  assert.equal(scoreOf(categories, "exposed_organs_dismemberment"), undefined)
  assert.equal(scoreOf(categories, "disturbing_dead_bodies"), undefined)
})

test("mapSightengineResponseToCategories: csam_suspected is never derived from this provider, regardless of input", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ nudity: { ...SAFE_NUDITY, sexual_activity: 0.99 }, gore: { prob: 0.99 } })
  )!
  assert.equal(scoreOf(categories, "csam_suspected"), undefined)
})

test("mapSightengineResponseToCategories: violence.prob (a distinct model from gore) drives violence", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ violence: { prob: 0.75, classes: { physical_violence: 0.75, firearm_threat: 0.01, combat_sport: 0.01 } } })
  )!
  assert.equal(scoreOf(categories, "violence"), 0.75)
})

test("mapSightengineResponseToCategories: a real firearm/knife drives weapons", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ weapon: { classes: { firearm: 0.9, firearm_gesture: 0.01, firearm_toy: 0.01, knife: 0.02 }, firearm_type: {}, firearm_action: {} } })
  )!
  assert.equal(scoreOf(categories, "weapons"), 0.9)
})

test("mapSightengineResponseToCategories: a toy gun or a hand mimicking one does NOT count as weapons", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ weapon: { classes: { firearm: 0.01, firearm_gesture: 0.95, firearm_toy: 0.95, knife: 0.01 }, firearm_type: {}, firearm_action: {} } })
  )!
  assert.ok((scoreOf(categories, "weapons") ?? 0) < 0.05)
})

test("mapSightengineResponseToCategories: recreational or medical drug signal drives drugs", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ recreational_drug: { prob: 0.88, classes: {} } })
  )!
  assert.equal(scoreOf(categories, "drugs"), 0.88)
})

test("mapSightengineResponseToCategories: nazi/confederate/supremacist/terrorist symbols drive hate_extremist", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ offensive: { prob: 0.9, nazi: 0.9, confederate: 0.01, supremacist: 0.01, terrorist: 0.01, middle_finger: 0.01, boxes: [] } })
  )!
  assert.equal(scoreOf(categories, "hate_extremist"), 0.9)
})

test("mapSightengineResponseToCategories: a middle-finger gesture alone does NOT count as hate_extremist", () => {
  const categories = mapSightengineResponseToCategories(
    fixture({ offensive: { prob: 0.9, nazi: 0.01, confederate: 0.01, supremacist: 0.01, terrorist: 0.01, middle_finger: 0.95, boxes: [] } })
  )!
  assert.ok((scoreOf(categories, "hate_extremist") ?? 0) < 0.05)
})

test("mapSightengineResponseToCategories: a response missing an entire requested model's data fails closed (returns null)", () => {
  const body = fixture()
  delete (body as Record<string, unknown>).gore
  assert.equal(mapSightengineResponseToCategories(body), null)
})

test("parseSightengineResponse: a well-formed success envelope maps categories and carries the request id as providerReference", () => {
  const outcome = parseSightengineResponse(fixture())
  assert.equal(outcome.ok, true)
  if (outcome.ok) assert.equal(outcome.analysis.providerReference, "req_test123")
})

test("parseSightengineResponse: a failure envelope (e.g. bad credentials) is reported as a generic error, never exposed further", () => {
  const outcome = parseSightengineResponse({
    status: "failure",
    request: { id: "req_x", timestamp: 1, operations: 0 },
    error: { type: "argument_error", code: 1, message: "Incorrect API user or API secret" },
  })
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, "error")
})

test("parseSightengineResponse: an unrecognized status value fails closed as malformed_response", () => {
  const outcome = parseSightengineResponse({ status: "??? not a real status ???" })
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, "malformed_response")
})

test("parseSightengineResponse: a non-object body fails closed as malformed_response", () => {
  const outcome = parseSightengineResponse("not even an object")
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, "malformed_response")
})

// --- SightengineProvider.analyze() — the real request/response/timeout
// plumbing, with global fetch monkey-patched rather than a real network
// call, so this still runs without real Sightengine credentials.
const realFetch = globalThis.fetch

test("SightengineProvider.analyze: a successful response is mapped end to end, and credentials are sent as multipart fields", async () => {
  let capturedForm: FormData | null = null
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedForm = init?.body as FormData
    return new Response(JSON.stringify(fixture({ gore: { prob: 0.6 } })), { status: 200 })
  }) as typeof fetch
  try {
    const provider = new SightengineProvider("test-user", "test-secret")
    const outcome = await provider.analyze(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "png")
    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(scoreOf(outcome.analysis.categories, "gore"), 0.6)
    assert.ok(capturedForm, "a multipart form body should have been sent")
    assert.equal(capturedForm!.get("api_user"), "test-user")
    assert.equal(capturedForm!.get("api_secret"), "test-secret")
    assert.ok(capturedForm!.get("media"), "the image bytes should have been attached as the media field")
  } finally {
    globalThis.fetch = realFetch
  }
})

test("SightengineProvider.analyze: an HTTP-level error status fails closed as 'error'", async () => {
  globalThis.fetch = (async () => new Response("upstream error", { status: 500 })) as typeof fetch
  try {
    const provider = new SightengineProvider("test-user", "test-secret")
    const outcome = await provider.analyze(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "png")
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.reason, "error")
  } finally {
    globalThis.fetch = realFetch
  }
})

test(
  "SightengineProvider.analyze: a hung request past REQUEST_TIMEOUT_MS fails closed as 'timeout'",
  async () => {
    // A fetch that never resolves on its own, but honors the abort signal
    // exactly the way the real global fetch does — this exercises this
    // class's actual AbortController wiring (it really does fire, at the
    // real production 8s timeout) rather than a fetch that fails for some
    // unrelated reason and happens to also produce an AbortError.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted")
          err.name = "AbortError"
          reject(err)
        })
      })) as typeof fetch
    try {
      const provider = new SightengineProvider("test-user", "test-secret")
      const outcome = await provider.analyze(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "png")
      assert.equal(outcome.ok, false)
      if (!outcome.ok) assert.equal(outcome.reason, "timeout")
    } finally {
      globalThis.fetch = realFetch
    }
  },
  { timeout: 15_000 }
)
