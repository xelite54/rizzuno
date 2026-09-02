import type { CategoryScore, ModerationCategory } from "./types"
import type { ModerationProvider, ProviderOutcome } from "./provider"

/**
 * The real, production moderation provider — Sightengine
 * (https://sightengine.com), called directly against its own documented
 * REST API (https://api.sightengine.com/1.0/check.json), not through
 * Sightengine's own published `sightengine` npm package: that package
 * (github.com/Sightengine/client-nodejs) hasn't been updated since 2018
 * and pins `node-fetch@^1.6.3`, which carries a real, unpatched HIGH
 * severity vulnerability (GHSA-r683-j2x4-v87g — node-fetch forwards
 * Authorization/secure headers to whatever host a redirect points at,
 * confirmed via `npm audit` against that exact package) — installing it
 * would mean this integration's own api_user/api_secret could leak to an
 * untrusted host on a malicious/compromised redirect. The REST API this
 * calls IS Sightengine's real, official, versioned product; only their
 * abandoned convenience wrapper is skipped, for the same reason
 * imageValidation.ts gates `image-size` on real magic bytes first — see
 * that file's own doc comment for the parallel.
 *
 * Configured via SIGHTENGINE_API_USER + SIGHTENGINE_API_SECRET (see
 * .env.example) — must be set in BOTH the Next.js app's deployment
 * (Vercel) and the realtime server's deployment (Railway), same as
 * DATABASE_URL/REALTIME_TICKET_SECRET already are, since app/api/profile/
 * me + app/api/profile/posts call moderateImage() from the Vercel process
 * and server/ws-server.ts's "chat" image handler calls it from the
 * Railway process — both need real credentials to do anything but fail
 * closed.
 */

const SIGHTENGINE_ENDPOINT = "https://api.sightengine.com/1.0/check.json"
const REQUEST_TIMEOUT_MS = 8000

// One combined request scores every model Rizzuno's internal categories
// need (see mapSightengineResponseToCategories below) — Sightengine bills
// per model invoked, and a single call with a comma-separated `models`
// list is one operation per model, same cost as separate calls, but one
// round trip and one timeout window instead of several.
const MODELS = "nudity-2.1,gore,violence,weapon,recreational_drug,medical,offensive"

export class SightengineProvider implements ModerationProvider {
  readonly name = "sightengine"
  // NOT a Sightengine-supplied model/API version — Sightengine's API
  // doesn't expose one to check against. This is this FILE's own
  // integration-mapping version instead (parallel to policy.ts's
  // POLICY_VERSION), part of the moderation cache's key (see
  // lib/db.ts's getCachedModerationDecision) — bump it whenever
  // mapSightengineResponseToCategories below actually changes, so a
  // mapping-logic change can't silently reuse a decision computed under
  // the old mapping.
  readonly modelVersion = "sightengine-map-v1"

  constructor(
    private readonly apiUser: string,
    private readonly apiSecret: string
  ) {}

  async analyze(bytes: Buffer, format: string): Promise<ProviderOutcome> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const form = new FormData()
      // Buffer is a real Uint8Array at runtime — Node's built-in Blob
      // accepts it directly. The cast below is purely a TS lib-type
      // mismatch (Buffer's ArrayBufferLike admits SharedArrayBuffer,
      // which BlobPart's typing doesn't); bytes here always came from
      // Buffer.from(base64, "base64") (imageValidation.ts), never a
      // SharedArrayBuffer-backed view. A filename/content-type are
      // included for clarity on Sightengine's end; the actual format was
      // already independently verified from real magic bytes before this
      // was ever reached (imageValidation.ts) — nothing here trusts this
      // string, it's just being informative.
      form.append("media", new Blob([bytes as unknown as BlobPart], { type: mimeTypeFor(format) }), `image.${extensionFor(format)}`)
      form.append("models", MODELS)
      form.append("api_user", this.apiUser)
      form.append("api_secret", this.apiSecret)

      const res = await fetch(SIGHTENGINE_ENDPOINT, {
        method: "POST",
        body: form,
        signal: controller.signal,
      })

      // Checked before ever trying to parse a body — an HTTP-level failure
      // (a 5xx from Sightengine itself, or from something in front of it
      // like a proxy/gateway) is classified as "error" even if its body
      // happens not to be JSON at all (an HTML error page, plain text,
      // etc.), rather than being misclassified as "malformed_response"
      // (which is reserved for a 200 whose *body* doesn't look right).
      if (!res.ok) {
        console.error("imageModeration: sightengine returned a non-OK HTTP status", { status: res.status })
        return { ok: false, reason: "error" }
      }

      let body: unknown
      try {
        body = await res.json()
      } catch {
        console.error("imageModeration: sightengine response was not valid JSON", { status: res.status })
        return { ok: false, reason: "malformed_response" }
      }

      return parseSightengineResponse(body)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("imageModeration: sightengine request timed out")
        return { ok: false, reason: "timeout" }
      }
      console.error("imageModeration: sightengine request failed", { error: err instanceof Error ? err.message : String(err) })
      return { ok: false, reason: "error" }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function mimeTypeFor(format: string): string {
  switch (format) {
    case "png":
      return "image/png"
    case "jpeg":
      return "image/jpeg"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}

function extensionFor(format: string): string {
  return format === "jpeg" ? "jpg" : format
}

/**
 * Sightengine's own success/failure envelope
 * (https://sightengine.com/docs/api-error-codes-and-responses):
 *   { "status": "success", "request": {...}, <model keys...>, "media": {...} }
 *   { "status": "failure", "request": {...}, "error": { "type", "code", "message" } }
 * A failure envelope (bad credentials, invalid input Sightengine itself
 * rejected, rate-limited by Sightengine, etc.) is logged server-side with
 * their own error detail and reported up as a generic "error" — never
 * exposed to a route/user, exactly like every other provider failure mode
 * (see index.ts's FAIL CLOSED handling). Anything that isn't recognizably
 * one of these two envelope shapes is "malformed_response".
 */
function parseSightengineResponse(body: unknown): ProviderOutcome {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "malformed_response" }
  const status = (body as { status?: unknown }).status

  if (status === "failure") {
    const error = (body as { error?: { type?: unknown; code?: unknown; message?: unknown } }).error
    console.error("imageModeration: sightengine reported a failure", {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    })
    return { ok: false, reason: "error" }
  }
  if (status !== "success") return { ok: false, reason: "malformed_response" }

  const categories = mapSightengineResponseToCategories(body as Record<string, unknown>)
  if (categories === null) return { ok: false, reason: "malformed_response" }

  const requestId = (body as { request?: { id?: unknown } }).request?.id
  return {
    ok: true,
    analysis: { categories, providerReference: typeof requestId === "string" ? requestId : null },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function maxOf(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length > 0 ? Math.max(...present) : null
}

/**
 * Translates Sightengine's own response fields into Rizzuno's internal
 * ModerationCategory vocabulary (types.ts) — the ONLY place that happens;
 * nothing downstream of provider.analyze() ever sees a raw Sightengine
 * field name (see this module's own top-of-file doc comment, and
 * provider.ts's own doc comment on why this mapping step is required for
 * any real vendor integration). Every mapping below is a deliberate,
 * documented approximation — Sightengine's own categories are never
 * exactly Rizzuno's:
 *
 *   explicit_sexual   <- max(nudity.sexual_activity, nudity.sexual_display)
 *   nudity            <- max(nudity.erotica, nudity.suggestive_classes.visibly_undressed)
 *   suggestive_sexual <- max(nudity.very_suggestive, nudity.suggestive, nudity.mildly_suggestive)
 *   graphic_violence  <- gore.prob
 *   gore              <- gore.prob (same source as graphic_violence —
 *     Sightengine's own docs describe this one model as covering "gory,
 *     bloody or horrific imagery related to wounds, harm, and death"
 *     generally, not as two separate signals)
 *   violence          <- violence.prob (Sightengine's separate physical-
 *     violence/threat model: fights, restraint, a weapon aimed at someone —
 *     distinct from gore)
 *   weapons           <- max(weapon.classes.firearm, weapon.classes.knife)
 *     (weapon.classes.firearm_toy/firearm_gesture — a toy gun, a hand
 *     mimicking one — are deliberately excluded: neither is an actual
 *     weapon)
 *   drugs             <- max(recreational_drug.prob, medical.prob)
 *   hate_extremist    <- max(offensive.nazi, offensive.confederate,
 *     offensive.supremacist, offensive.terrorist) — offensive.middle_finger
 *     is deliberately excluded: a rude gesture is not hate/extremist imagery
 *   csam_suspected    <- never derived here, or from any generic nudity/
 *     explicit-sexual score — see severeContent.ts's own doc comment
 *
 * Sightengine does not separately distinguish severe_injury,
 * exposed_organs_dismemberment, or disturbing_dead_bodies from ordinary
 * gore — rather than fabricating a specific sub-label Sightengine never
 * actually determined (the same principle severeContent.ts applies to
 * csam_suspected: never invent signal a detector didn't really produce),
 * those three Rizzuno categories are deliberately left unscored by this
 * provider. This does not weaken enforcement — an image severe enough to
 * warrant one of those three labels will still score high on gore/
 * graphic_violence and be blocked on that basis; it only means
 * moderation_events won't carry that specific sub-label for it.
 *
 * Returns null (-> malformed_response -> fail closed, per index.ts) if the
 * response is missing an entire requested model's top-level object — that
 * means either the `models` list above and Sightengine's actual response
 * have drifted out of sync, or the response shape isn't what this
 * integration was built against; either way, silently scoring the missing
 * model as 0 would be indistinguishable from a real, confident "safe"
 * result, which is exactly the failure mode FAIL CLOSED exists to prevent.
 */
function mapSightengineResponseToCategories(body: Record<string, unknown>): CategoryScore[] | null {
  const nudity = asRecord(body.nudity)
  const gore = asRecord(body.gore)
  const violence = asRecord(body.violence)
  const weapon = asRecord(body.weapon)
  const recreationalDrug = asRecord(body.recreational_drug)
  const medical = asRecord(body.medical)
  const offensive = asRecord(body.offensive)
  if (!nudity || !gore || !violence || !weapon || !recreationalDrug || !medical || !offensive) return null

  const weaponClasses = asRecord(weapon.classes)
  const nudityClasses = asRecord(nudity.suggestive_classes)

  const scores: CategoryScore[] = []
  const push = (category: ModerationCategory, score: number | null) => {
    if (score !== null) scores.push({ category, score })
  }

  push("explicit_sexual", maxOf(num(nudity.sexual_activity), num(nudity.sexual_display)))
  push("nudity", maxOf(num(nudity.erotica), nudityClasses ? num(nudityClasses.visibly_undressed) : null))
  push("suggestive_sexual", maxOf(num(nudity.very_suggestive), num(nudity.suggestive), num(nudity.mildly_suggestive)))
  push("graphic_violence", num(gore.prob))
  push("gore", num(gore.prob))
  push("violence", num(violence.prob))
  push("weapons", weaponClasses ? maxOf(num(weaponClasses.firearm), num(weaponClasses.knife)) : null)
  push("drugs", maxOf(num(recreationalDrug.prob), num(medical.prob)))
  push(
    "hate_extremist",
    maxOf(num(offensive.nazi), num(offensive.confederate), num(offensive.supremacist), num(offensive.terrorist))
  )

  return scores.length > 0 ? scores : null
}

// Exported for tests/imageModerationSightengine.test.mts only — verifies
// the mapping above directly against realistic, documented Sightengine
// response shapes, and parseSightengineResponse's envelope handling,
// without needing a real network call.
export const __test__ = { mapSightengineResponseToCategories, parseSightengineResponse }
