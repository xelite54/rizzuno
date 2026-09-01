import { recordModerationEvent, getCachedModerationDecision } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { validateAndDecodeImage } from "./imageValidation"
import { hashImageBytes } from "./hash"
import { decideModeration, POLICY_VERSION } from "./policy"
import { getConfiguredProvider } from "./provider"
import { checkSevereContent } from "./severeContent"
import { checkAbuseRestriction } from "./abuse"
import type { ModerateImageInput, ModerationResult, CategoryScore } from "./types"

/**
 * THE one centralized image-moderation pipeline. Every profile photo,
 * post, and chat image — on every surface, from every route — must call
 * this and check `decision === "allow"` before the image is ever
 * persisted or forwarded to another user. There is no other code path
 * anywhere in this repo that's allowed to decide an image is safe; see
 * this directory's other files for the pieces this composes:
 *   imageValidation.ts — real, decoded-byte format/dimension checks
 *   hash.ts             — the moderation cache key
 *   policy.ts           — THE decision engine (thresholds live only here)
 *   provider.ts          — the pluggable detector (never the decider)
 *   severeContent.ts    — the separate CSAM-suspicion extension point
 *   abuse.ts            — violation-history escalation
 *
 * `userId` must already be a verified session id (session.user.id from
 * auth()) — this function does not authenticate anything itself; every
 * caller in app/api/ and server/ws-server.ts only ever passes the id its
 * own auth check already resolved, never anything client-supplied.
 *
 * Rate limits, upload byte/dimension limits, category thresholds, and the
 * abuse-escalation ladder are all reasonable starting defaults (see each
 * module's own doc comment) — not empirically validated against real
 * traffic or a real provider account, since this environment has neither.
 */
export async function moderateImage(input: ModerateImageInput): Promise<ModerationResult> {
  const { userId, dataUrl, surface } = input

  // 1) Upload rate limit — independent of anything content-related, and
  // independent of the 20-post storage cap (see lib/db.ts's addPost): a
  // rapid upload/delete/upload/delete cycle never gets more provider
  // calls than this allows, even though the STORED post count stays at
  // or under 20 throughout. Checked before touching the image at all.
  if (isRateLimited(`image-moderation:${surface}:${userId}`, RATE_LIMITS[surface], RATE_LIMIT_WINDOW_MS)) {
    console.warn("imageModeration: rate limited", { surface })
    return { decision: "block", categories: [], provider: "rate_limited", moderationId: "", unavailable: true }
  }

  // Recent-violation-pattern check — before any provider call, so an
  // account already over the threshold doesn't cost a provider call for
  // an upload that's being rejected regardless (see abuse.ts).
  const abuseCheck = await checkAbuseRestriction(userId)
  if (abuseCheck.restricted) {
    console.warn("imageModeration: upload restricted after recent violations", { surface, reason: abuseCheck.reason })
    return { decision: "block", categories: [], provider: "restricted", moderationId: "", unavailable: false }
  }

  // 2/3/4) Validate encoded image, validate actual decoded type, enforce
  // byte/dimension limits — all of imageValidation.ts's job.
  const validated = validateAndDecodeImage(dataUrl)
  if (!validated.ok) {
    console.warn("imageModeration: rejected at validation", { surface, reason: validated.reason })
    return { decision: "block", categories: [], provider: "validation", moderationId: "", unavailable: false }
  }

  // 5) Normalize/resize if necessary — the client already resizes before
  // upload (lib/image.ts's resizeImageToDataUrl), and this pipeline has
  // no server-side image re-encoder (adding one, e.g. sharp, is a real,
  // separate infrastructure decision — native-binary dependencies on top
  // of everything already validated above). What "normalize" means here
  // today is exactly the validated, decoded byte buffer from the step
  // above — the hash below is computed from these real bytes either way,
  // so re-encoding would only ever change the hash, never the safety
  // guarantees already enforced.
  const bytes = validated.bytes

  // 6) Hash.
  const imageHash = hashImageBytes(bytes)

  // 7) Moderation cache — the exact same normalized bytes, already
  // decided under the exact same policy + provider model version, reuses
  // that decision instead of a fresh provider call.
  const provider = getConfiguredProvider()
  const cached = await getCachedModerationDecision(imageHash, POLICY_VERSION, provider.modelVersion)
  if (cached) {
    console.log("imageModeration: cache hit", { surface, decision: cached.decision })
    // Still one row per attempt (see this function's own note on why) —
    // just without a provider call.
    // lib/db.ts's ModerationCategoryScore deliberately types `category` as a
    // plain string (the DB layer has no business knowing this module's
    // specific ModerationCategory union) — safe to narrow back here since
    // these values only ever came from decideModeration()/this module's own
    // provider.ts in the first place.
    const cachedCategories = cached.categories as CategoryScore[]
    const moderationId = await recordModerationEvent({
      userId,
      surface,
      imageHash,
      decision: cached.decision,
      categories: cachedCategories,
      provider: cached.provider,
      providerReference: cached.providerReference,
      policyVersion: POLICY_VERSION,
      providerModelVersion: provider.modelVersion,
    })
    return { decision: cached.decision, categories: cachedCategories, provider: cached.provider, moderationId }
  }

  // 8) Moderation provider (the DETECTOR) + the separate severe-content
  // check (severeContent.ts), run together — see FAIL CLOSED below for
  // what an unavailable/failed provider means for the outcome. A
  // provider failure, a rate-limit, or a validation failure are NEVER
  // logged as moderation_events (see this function's own note above each
  // early return) — only an attempt that actually produced real category
  // scores is a genuine content decision worth recording and worth
  // counting toward abuse.ts's escalation.
  const [outcome, severeCategories] = await Promise.all([provider.analyze(bytes, validated.format), checkSevereContent(bytes)])

  if (!outcome.ok) {
    // FAIL CLOSED — a provider that times out, errors, is unconfigured,
    // or returns something malformed is NEVER interpreted as "safe". No
    // moderation_events row: this was never actually evaluated.
    console.error("imageModeration: provider unavailable — failing closed, image rejected", { surface, reason: outcome.reason })
    return { decision: "block", categories: [], provider: provider.name, moderationId: "", unavailable: true }
  }

  const categories: CategoryScore[] = [...outcome.analysis.categories, ...severeCategories]

  // 9/10) THE policy engine — the only place that turns scores into a
  // decision. review is treated as reject (no publish) exactly like
  // block, per this module's own review-without-a-human-queue policy —
  // see policy.ts and this function's return below; the DISTINCTION
  // between "review" and "block" is preserved in what gets logged, for a
  // future human-review queue to use, even though today both mean the
  // same thing to the uploader.
  const decision = decideModeration(categories)

  const moderationId = await recordModerationEvent({
    userId,
    surface,
    imageHash,
    decision,
    categories,
    provider: provider.name,
    providerReference: outcome.analysis.providerReference,
    policyVersion: POLICY_VERSION,
    providerModelVersion: provider.modelVersion,
  })

  if (decision !== "allow") {
    console.warn("imageModeration: rejected by policy", { surface, decision })
  }

  return { decision, categories, provider: provider.name, moderationId }
}

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMITS: Record<ModerateImageInput["surface"], number> = {
  profile_photo: 10,
  post: 20,
  chat: 30,
}

export type { ModerationResult, ModerateImageInput, ModerationSurface, ModerationDecision, CategoryScore } from "./types"
