/**
 * The current required version of each document a user must have accepted.
 * Bumping a version here means anyone who already accepted the old one is
 * no longer considered current — lib/db.ts's `hasAcceptedCurrent` re-checks
 * against whatever's listed here, and the acceptance gate reappears for
 * them automatically. Their original acceptance record is never rewritten
 * or deleted (see lib/db.ts) — this only changes what counts as "current"
 * going forward.
 *
 * No dependency on node:sqlite or anything server-only — safe to import
 * from client components too (e.g. to show "you're being asked again
 * because Terms changed" copy), unlike lib/db.ts itself.
 */
export const REQUIRED_DOCUMENTS: { document: "age18" | "terms" | "privacy"; version: string }[] = [
  { document: "age18", version: "1" },
  { document: "terms", version: "2026-08-22" },
  { document: "privacy", version: "2026-08-22" },
]
