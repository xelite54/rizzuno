import type { CategoryScore, ModerationCategory } from "./types"

/**
 * The DETECTOR half of "the external provider is the DETECTOR, Rizzuno's
 * own policy engine is the DECISION MAKER" — this file only ever produces
 * category scores; it never decides allow/review/block itself (see
 * policy.ts for that). Swappable behind this one interface so a real
 * vendor integration is a matter of implementing `analyze()`, not
 * touching index.ts or any route.
 */

export type ProviderAnalysis = {
  categories: CategoryScore[]
  /** Vendor's own id for this specific analysis, if it returns one — stored in moderation_events for support/audit purposes, never shown to the uploader. */
  providerReference: string | null
}

export type ProviderOutcome =
  | { ok: true; analysis: ProviderAnalysis }
  | { ok: false; reason: "unconfigured" | "timeout" | "error" | "malformed_response" }

export interface ModerationProvider {
  readonly name: string
  /** Bumped whenever the underlying vendor model/API version this integration targets changes — part of the moderation cache's key (see policy.ts's POLICY_VERSION and lib/db.ts's getCachedModerationDecision) so a provider upgrade can't silently reuse a decision scored by the old model. */
  readonly modelVersion: string
  analyze(bytes: Buffer, format: string): Promise<ProviderOutcome>
}

const REQUEST_TIMEOUT_MS = 8000

/**
 * A real vendor integration — the exact request/response shape here is a
 * generic placeholder (POST the image, get back a flat list of
 * {category, score}), modeled on how most REST content-moderation APIs
 * (Sightengine, Hive, Google Cloud Vision SafeSearch, AWS Rekognition,
 * Azure Content Moderator, etc.) are roughly shaped — but this has NOT
 * been validated against any real vendor's actual API from this
 * environment, which has no provider credentials or network access to
 * test one. Wiring a specific real vendor means adapting
 * `buildRequest`/`parseResponse` below to that vendor's actual contract,
 * and mapping ITS OWN category names into Rizzuno's internal
 * ModerationCategory vocabulary (types.ts) — never passing its raw labels
 * through unmapped.
 *
 * Configured via IMAGE_MODERATION_PROVIDER_URL + IMAGE_MODERATION_API_KEY
 * (see .env.example) — see getConfiguredProvider() below for what happens
 * when either is unset.
 */
class HttpModerationProvider implements ModerationProvider {
  readonly name = "http"
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    readonly modelVersion: string
  ) {}

  async analyze(bytes: Buffer, format: string): Promise<ProviderOutcome> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          image: bytes.toString("base64"),
          format,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        console.error("imageModeration: provider returned a non-OK status", { status: res.status })
        return { ok: false, reason: "error" }
      }
      const body: unknown = await res.json()
      return parseProviderResponse(body)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("imageModeration: provider request timed out")
        return { ok: false, reason: "timeout" }
      }
      console.error("imageModeration: provider request failed", { error: err instanceof Error ? err.message : String(err) })
      return { ok: false, reason: "error" }
    } finally {
      clearTimeout(timeout)
    }
  }
}

const KNOWN_CATEGORIES = new Set<ModerationCategory>([
  "nudity",
  "explicit_sexual",
  "suggestive_sexual",
  "graphic_violence",
  "gore",
  "severe_injury",
  "exposed_organs_dismemberment",
  "disturbing_dead_bodies",
  "violence",
  "hate_extremist",
  "drugs",
  "weapons",
  "csam_suspected",
])

/** Never trusts the response shape — a provider returning malformed JSON, an unexpected shape, or scores outside [0,1] is treated as a failure (FAIL CLOSED — see index.ts), never partially accepted. */
function parseProviderResponse(body: unknown): ProviderOutcome {
  if (typeof body !== "object" || body === null || !("categories" in body) || !Array.isArray((body as { categories: unknown }).categories)) {
    return { ok: false, reason: "malformed_response" }
  }
  const raw = (body as { categories: unknown[] }).categories
  const categories: CategoryScore[] = []
  for (const entry of raw) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { category?: unknown }).category !== "string" ||
      typeof (entry as { score?: unknown }).score !== "number"
    ) {
      return { ok: false, reason: "malformed_response" }
    }
    const category = (entry as { category: string }).category as ModerationCategory
    const score = (entry as { score: number }).score
    if (!KNOWN_CATEGORIES.has(category) || Number.isNaN(score) || score < 0 || score > 1) {
      // An unrecognized category name or an out-of-range score is a sign
      // the vendor integration's mapping (see this file's own doc
      // comment) is wrong, not something to silently drop and continue —
      // fail the whole analysis rather than decide on a partial, possibly
      // wrong picture.
      return { ok: false, reason: "malformed_response" }
    }
    categories.push({ category, score })
  }
  const referenceRaw = (body as { reference?: unknown }).reference
  return {
    ok: true,
    analysis: { categories, providerReference: typeof referenceRaw === "string" ? referenceRaw : null },
  }
}

/** Always reports "unconfigured" — never silently treated as "nothing to flag" (see index.ts, which fails closed on this exact outcome). This is what a fresh checkout / an environment with no real moderation vendor configured gets by default; images cannot be approved without a real provider actually running. */
class UnconfiguredProvider implements ModerationProvider {
  readonly name = "unconfigured"
  readonly modelVersion = "none"
  async analyze(): Promise<ProviderOutcome> {
    return { ok: false, reason: "unconfigured" }
  }
}

let cachedProvider: ModerationProvider | null = null

/**
 * Selects the real provider if IMAGE_MODERATION_PROVIDER_URL and
 * IMAGE_MODERATION_API_KEY are both set, otherwise the always-unavailable
 * one — resolved once and reused (the env doesn't change mid-process).
 */
export function getConfiguredProvider(): ModerationProvider {
  if (cachedProvider) return cachedProvider
  const endpoint = process.env.IMAGE_MODERATION_PROVIDER_URL
  const apiKey = process.env.IMAGE_MODERATION_API_KEY
  const modelVersion = process.env.IMAGE_MODERATION_PROVIDER_MODEL_VERSION || "unspecified"
  cachedProvider = endpoint && apiKey ? new HttpModerationProvider(endpoint, apiKey, modelVersion) : new UnconfiguredProvider()
  return cachedProvider
}

/** Test-only seam — tests/imageModerationPolicy.test.mts injects a fake provider instead of reaching for a real network call. Never used outside tests. */
export function setProviderForTesting(provider: ModerationProvider | null) {
  cachedProvider = provider
}
