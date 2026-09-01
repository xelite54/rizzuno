import type { CategoryScore, ModerationCategory, ModerationDecision } from "./types"

/**
 * THE one policy engine — every image, on every surface, is decided here
 * and nowhere else. A moderation provider (provider.ts) only ever detects
 * and scores categories; this file is what turns those scores into an
 * allow/review/block decision. No route, no other module, duplicates or
 * overrides these thresholds — see index.ts, which is the only caller.
 *
 * Bumped whenever the thresholds below actually change — part of the
 * moderation cache's key (lib/db.ts's getCachedModerationDecision) along
 * with the provider's own model version, so a policy change can never
 * silently reuse a decision made under the old rules.
 */
export const POLICY_VERSION = "1"

type CategoryPolicy = {
  /** At or above this score, this category alone forces BLOCK. */
  block: number
  /** At or above this score (but below `block`), this category alone forces REVIEW. Below this, the category contributes nothing to the decision. */
  review: number
}

/**
 * Deliberately conservative defaults, not empirically tuned against real
 * provider score distributions — this is a starting configuration for
 * Rizzuno's actual trust & safety policy owner to calibrate once a real
 * provider is wired up (see provider.ts), not a validated final answer.
 * `csam_suspected` has no thresholds at all — see its own entry below.
 */
const CATEGORY_POLICY: Record<ModerationCategory, CategoryPolicy> = {
  nudity: { block: 0.5, review: 0.2 },
  explicit_sexual: { block: 0.35, review: 0.15 },
  // "suggestive content -> REVIEW/BLOCK conservatively": a high bar for
  // BLOCK (this alone isn't explicit), but a low bar for REVIEW — this is
  // the "conservative" half of that instruction.
  suggestive_sexual: { block: 0.75, review: 0.3 },
  graphic_violence: { block: 0.5, review: 0.2 },
  gore: { block: 0.4, review: 0.15 },
  severe_injury: { block: 0.45, review: 0.2 },
  exposed_organs_dismemberment: { block: 0.3, review: 0.1 },
  disturbing_dead_bodies: { block: 0.4, review: 0.15 },
  // "moderate violence -> REVIEW": a high BLOCK bar, low REVIEW bar — a
  // clearly violent image reviews; only a severe one blocks outright.
  violence: { block: 0.7, review: 0.3 },
  hate_extremist: { block: 0.4, review: 0.15 },
  drugs: { block: 0.75, review: 0.4 },
  weapons: { block: 0.8, review: 0.45 },
  // Never scored by threshold — see severeContent.ts's own doc comment on
  // why this category is never derived from generic nudity/explicit-
  // sexual confidence. If it is ever set at all (score > 0), it means a
  // specialized check flagged the image directly — any nonzero signal
  // forces BLOCK, full stop, with no "review" middle ground.
  csam_suspected: { block: 0, review: 0 },
}

const DECISION_SEVERITY: Record<ModerationDecision, number> = { allow: 0, review: 1, block: 2 }

/**
 * The actual decision — the most severe outcome across every category the
 * provider (or the separate severe-content check — see severeContent.ts)
 * returned a score for. A single category hitting BLOCK is enough to
 * block the whole image; nothing here tries to "average" severity across
 * categories, since that would let several moderately-scored categories
 * cancel each other out into a false ALLOW.
 */
export function decideModeration(categories: CategoryScore[]): ModerationDecision {
  let decision: ModerationDecision = "allow"
  for (const { category, score } of categories) {
    const policy = CATEGORY_POLICY[category]
    if (!policy) continue // an unrecognized category from a provider is never trusted to affect the decision
    const categoryDecision: ModerationDecision =
      category === "csam_suspected"
        ? score > 0
          ? "block"
          : "allow"
        : score >= policy.block
          ? "block"
          : score >= policy.review
            ? "review"
            : "allow"
    if (DECISION_SEVERITY[categoryDecision] > DECISION_SEVERITY[decision]) decision = categoryDecision
  }
  return decision
}
