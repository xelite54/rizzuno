/**
 * Legal/business identity values that only Rizzuno's operator can supply —
 * deliberately never invented here (see the LEGAL REVIEW PACKET delivered
 * alongside this file for exactly why each one is still `null` and what's
 * needed before production/Google OAuth verification).
 *
 * Every value defaults to `null`. The Terms/Privacy pages render clean,
 * non-repetitive fallback text for whatever's still unset here — never a
 * "placeholder, not reviewed" warning, and never four near-identical
 * "hasn't been published yet" sentences stacked in a row. A purely optional
 * clause (governing law, dispute resolution) is simply omitted from the
 * page when unset, rather than described as missing; operator identity and
 * a contact address are treated as more load-bearing, so those two get one
 * short, plain sentence acknowledging they're not set yet, instead of being
 * silently dropped.
 *
 * Once the operator provides real values, set them here and bump the
 * matching document version(s) in lib/legalVersions.ts so existing users
 * are asked to accept the updated Terms/Privacy again.
 */
export const LEGAL_CONFIG = {
  /** The legal entity or individual operating Rizzuno, e.g. "Example Inc., a Delaware corporation" or an individual's legal name. Printed in Terms/Privacy as "who operates Rizzuno." */
  operatorName: null as string | null,

  /** Registered/business address, if the operator wants one printed in Terms/Privacy. Not required by every jurisdiction, but some (e.g. GDPR) expect an identifiable controller address. Only rendered when operatorName is also set. */
  operatorAddress: null as string | null,

  /** General/privacy contact address shown in both Terms and Privacy (e.g. "privacy@rizzuno.com"). Google's OAuth consent screen also asks for a support email separately in Cloud Console — that's a different, required field this constant does not fill in. */
  contactEmail: null as string | null,

  /** Separate legal-notices address (e.g. for takedown/legal process), if different from contactEmail. Not currently referenced by either page; add a render site if/when the operator wants it surfaced separately. */
  legalEmail: null as string | null,

  /** Governing law / venue for disputes, e.g. "the laws of the State of Delaware, USA, without regard to conflict-of-laws rules." Purely optional — omitted from Terms entirely when unset, rather than described as missing (see file header). */
  governingLaw: null as string | null,

  /** Dispute-resolution clause (arbitration, small-claims carve-out, class-action waiver, etc.), if the operator wants one. A real clause needs a lawyer — this is not filled in speculatively. Omitted from Terms entirely when unset. */
  disputeResolution: null as string | null,
} as const
