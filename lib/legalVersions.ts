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
  // Bumped 2026-08-23: full rewrite from placeholder copy to production
  // Terms/Privacy text (see the legal-accuracy audit) — a material change,
  // so every account with a prior acceptance record is asked again.
  //
  // Bumped again same day (2026-08-23b): expanded both documents into the
  // fully sectioned production text (42 Terms sections, 18 Privacy
  // sections) and fixed the /terms + /privacy scroll-clipping bug — also
  // a material change, so accounts that already accepted "2026-08-23" are
  // asked again too. Neither bump touches or removes any prior acceptance
  // row (see lib/db.ts's recordAcceptance/hasAcceptedCurrent) — this list
  // only changes what counts as "current" going forward.
  { document: "terms", version: "2026-08-23b" },
  { document: "privacy", version: "2026-08-23b" },
]
