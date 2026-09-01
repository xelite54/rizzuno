import { createHash } from "node:crypto"

/**
 * SHA-256 of the already-validated, decoded image bytes (never the raw
 * data URL string — the same pixel content re-encoded with different
 * base64 padding/line breaks would otherwise hash differently and defeat
 * the moderation cache for no reason). This is what lib/db.ts's
 * moderation_events table keys its cache lookup on — see
 * getCachedModerationDecision()'s own doc comment.
 */
export function hashImageBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}
