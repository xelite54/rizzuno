/** Durations for ephemeral data only; legal/safety retention requires operator review. */
export const RETENTION = {
  expiredRateLimitGraceMs: 24 * 60 * 60 * 1000,
  imageRateWindowMs: 60 * 60 * 1000,
  turnRateWindowMs: 60 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
  // Null means no automatic purge, not a claim that indefinite retention is lawful.
  reports: null, moderation: null, legalAcceptances: null, friendMessages: null,
} as const
