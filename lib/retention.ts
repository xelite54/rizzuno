/** Technical expiry windows, not legal retention decisions. */
export const RETENTION = {
  expiredRateLimitGraceMs: 24 * 60 * 60 * 1000,
  imageRateWindowMs: 60 * 60 * 1000,
  turnRateWindowMs: 60 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
} as const

export const RETENTION_CATEGORIES = ["friendMessages", "friendRequests", "reports", "moderationActions", "imageChecks", "legalAcceptance", "privacyOperations", "accountTombstones", "storedImages", "heldRecords", "infrastructureLogs", "backups"] as const
export type RetentionCategory = typeof RETENTION_CATEGORIES[number]
export type RetentionRule = { mode: "automatic" | "external" | "review"; days?: number; reason: string }
export type RetentionPolicy = { approvedBy: string; caseReference: string; reviewBy: string; categories: Record<RetentionCategory, RetentionRule> }
/** No default durations: operator approval is a release input, never a legal inference. */
export function retentionPolicy(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  let policy: RetentionPolicy
  try { policy = JSON.parse(env.RETENTION_POLICY_JSON ?? "") } catch { throw new Error("Invalid configuration: RETENTION_POLICY_JSON") }
  if (!policy || !policy.approvedBy?.trim() || !/^[A-Za-z0-9_-]{6,80}$/.test(policy.caseReference ?? "") || !Number.isFinite(Date.parse(policy.reviewBy)) || Date.parse(policy.reviewBy) <= Date.now()) throw new Error("Retention approval missing or expired")
  for (const category of RETENTION_CATEGORIES) {
    const rule = policy.categories?.[category]
    if (!rule || !["automatic", "external", "review"].includes(rule.mode) || !rule.reason?.trim()) throw new Error(`Retention policy required: ${category}`)
    if (rule.mode !== "review" && (!Number.isSafeInteger(rule.days) || rule.days! <= 0 || rule.days! > 36500)) throw new Error(`Retention duration required: ${category}`)
    if (["accountTombstones"].includes(category) && rule.mode !== "review") throw new Error("Account tombstones require reviewed denial-of-reentry policy")
    if (["infrastructureLogs", "backups"].includes(category) && rule.mode !== "external") throw new Error(`Provider expiry required: ${category}`)
    if (!["infrastructureLogs", "backups"].includes(category) && rule.mode === "external") throw new Error(`Application retention cannot be delegated: ${category}`)
    if (category === "storedImages" && rule.mode !== "automatic") throw new Error("Orphaned images require automatic expiry")
  }
  return policy
}
