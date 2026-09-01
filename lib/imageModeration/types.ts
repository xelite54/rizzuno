/**
 * Shared types for the one centralized image-moderation pipeline (see
 * index.ts's moderateImage() — the only function anything outside this
 * directory should ever call). Nothing in this file talks to a database,
 * an HTTP provider, or Postgres — it's just the shapes every other file
 * here agrees on.
 */

/** Where an image came from — every surface goes through the exact same pipeline; this only affects what happens to the bytes AFTER an "allow" (which table/message it ends up in), never how it's judged. */
export type ModerationSurface = "profile_photo" | "post" | "chat"

/**
 * Rizzuno's own internal category vocabulary — what lib/imageModeration/
 * policy.ts's decisions are actually made from. A provider's own labels
 * (whatever a real vendor calls them) get normalized into these in
 * provider.ts; nothing downstream of that ever sees a raw provider label.
 *
 * `csam_suspected` is deliberately never derived from ordinary nudity/
 * explicit-sexual scores — see severeContent.ts's own doc comment for why,
 * and lib/imageModeration/policy.ts's own comment on this category's
 * always-hard-block, no-threshold treatment.
 */
export type ModerationCategory =
  | "nudity"
  | "explicit_sexual"
  | "suggestive_sexual"
  | "graphic_violence"
  | "gore"
  | "severe_injury"
  | "exposed_organs_dismemberment"
  | "disturbing_dead_bodies"
  | "violence"
  | "hate_extremist"
  | "drugs"
  | "weapons"
  | "csam_suspected"

export type CategoryScore = { category: ModerationCategory; score: number }

export type ModerationDecision = "allow" | "review" | "block"

/**
 * What moderateImage() returns to a caller — deliberately nothing more
 * than this. `categories`/`provider` exist for logging (moderation_events)
 * and internal debugging, never for showing a user WHY — see index.ts's
 * own doc comment on why no route should ever forward these fields into a
 * user-facing response.
 */
export type ModerationResult = {
  decision: ModerationDecision
  categories: CategoryScore[]
  provider: string
  moderationId: string
  /** Set only when the decision is a rejection caused by the provider itself being unusable (timeout/error/unconfigured), not a real content judgment — see index.ts's FAIL-CLOSED handling. Callers use this to choose between "Image not allowed" and "Couldn't check image — try again." */
  unavailable?: boolean
}

/** What moderateImage() needs from its caller — `userId` must already be a verified session id, never anything client-supplied (see index.ts's own doc comment). */
export type ModerateImageInput = {
  userId: string
  dataUrl: string
  surface: ModerationSurface
}
