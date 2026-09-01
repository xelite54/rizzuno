import { countRecentBlockedUploads } from "@/lib/db"
import type { CategoryScore } from "./types"

/**
 * Escalation, kept deliberately separate from the detector (provider.ts)
 * and the decision engine (policy.ts) — this only ever asks "has this
 * account been blocked enough times recently to warrant more than just
 * rejecting THIS one upload?", never "is this specific image bad?". A
 * single uncertain AI result never bans anyone; only a genuine pattern
 * escalates.
 */

// A general pattern of blocked uploads earns a temporary restriction —
// short enough that a real mistake (a since-fixed bug, a provider having
// an off day) doesn't lock someone out for long, long enough that it's a
// real deterrent against repeated attempts.
const RESTRICTION_THRESHOLD = 3
const RESTRICTION_WINDOW_MS = 24 * 60 * 60 * 1000

// Categories severe enough that even ONE recent block (not a pattern) is
// enough to restrict further uploads — "severe categories can have
// stricter escalation".
const SEVERE_CATEGORIES = ["csam_suspected", "exposed_organs_dismemberment", "gore"]
const SEVERE_RESTRICTION_THRESHOLD = 1
const SEVERE_RESTRICTION_WINDOW_MS = 24 * 60 * 60 * 1000

export type AbuseCheckResult = { restricted: boolean; reason?: "recent_pattern" | "severe_category" }

/**
 * Checked BEFORE the provider/policy engine even run for a given upload
 * (see index.ts) — an account already over the threshold is rejected
 * outright, saving a provider call for an upload that's going to be
 * refused regardless. Self-expiring by construction: this is a rolling
 * window COUNT, not a stored "restricted until" timestamp, so it never
 * needs its own cleanup job — once enough time passes without a new
 * block, the count naturally drops back under the threshold on its own.
 */
export async function checkAbuseRestriction(userId: string): Promise<AbuseCheckResult> {
  const now = Date.now()
  const severeCount = await countRecentBlockedUploads(userId, now - SEVERE_RESTRICTION_WINDOW_MS, SEVERE_CATEGORIES)
  if (severeCount >= SEVERE_RESTRICTION_THRESHOLD) {
    return { restricted: true, reason: "severe_category" }
  }
  const generalCount = await countRecentBlockedUploads(userId, now - RESTRICTION_WINDOW_MS)
  if (generalCount >= RESTRICTION_THRESHOLD) {
    return { restricted: true, reason: "recent_pattern" }
  }
  return { restricted: false }
}

/** Whether this specific set of categories (from a just-blocked upload) counts as "severe" for the stricter escalation path above — exported so index.ts's logging can note it, and so the threshold list stays in exactly one place. */
export function includesSevereCategory(categories: CategoryScore[]): boolean {
  return categories.some((c) => SEVERE_CATEGORIES.includes(c.category))
}
