/**
 * Legal/business identity values that only Rizzuno's operator can supply —
 * deliberately never invented here (see the LEGAL REVIEW PACKET delivered
 * alongside this file for exactly why each one is still `null` and what's
 * needed before production/Google OAuth verification).
 *
 * Every value defaults to `null`. The Terms/Privacy pages render a plain,
 * factual fallback line for anything left unset — never a "placeholder,
 * not reviewed" warning — so the pages stay publicly presentable while
 * these are pending. Once the operator provides real values, set them
 * here and bump the matching document version(s) in lib/legalVersions.ts
 * so existing users are asked to accept the updated Terms/Privacy again.
 */
export const LEGAL_CONFIG = {
  /** The legal entity or individual operating Rizzuno, e.g. "Example Inc., a Delaware corporation" or an individual's legal name. Printed in Terms/Privacy as "who operates Rizzuno." */
  operatorName: null as string | null,

  /** Registered/business address, if the operator wants one printed in Terms/Privacy. Not required by every jurisdiction, but some (e.g. GDPR) expect an identifiable controller address. */
  operatorAddress: null as string | null,

  /** General/privacy contact address shown in both Terms and Privacy (e.g. "privacy@rizzuno.com"). Google's OAuth consent screen also asks for a support email separately in Cloud Console — that's a different, required field this constant does not fill in. */
  contactEmail: null as string | null,

  /** Separate legal-notices address (e.g. for takedown/legal process), if different from contactEmail. Falls back to contactEmail when unset. */
  legalEmail: null as string | null,

  /** Governing law / venue for disputes, e.g. "the laws of the State of Delaware, USA, without regard to conflict-of-laws rules." */
  governingLaw: null as string | null,

  /** Dispute-resolution clause (arbitration, small-claims carve-out, class-action waiver, etc.), if the operator wants one. A real clause needs a lawyer — this is not filled in speculatively. */
  disputeResolution: null as string | null,
} as const

/** Renders a configured value, or a neutral, factual "not yet published" fallback — never alarmist placeholder language — when it's still null. */
export function legalValue(value: string | null, whatFor: string): string {
  return value ?? `Rizzuno's operator has not yet published ${whatFor}.`
}
