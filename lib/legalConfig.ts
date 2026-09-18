/** Operator-supplied identity; see docs/PRODUCTION_LEGAL_CHECKLIST.md. Never invent values. */
export const LEGAL_CONFIG = {
  /** The legal entity or individual operating Rizzuno, e.g. "Example Inc., a Delaware corporation" or an individual's legal name. Printed in Terms/Privacy as "who operates Rizzuno." */
  operatorName: process.env.LEGAL_OPERATOR_NAME || null,

  /** Registered/business address, if the operator wants one printed in Terms/Privacy. Not required by every jurisdiction, but some (e.g. GDPR) expect an identifiable controller address. Only rendered when operatorName is also set. */
  operatorAddress: process.env.LEGAL_OPERATOR_ADDRESS || null,

  /** General/privacy contact address shown in both Terms and Privacy. Google's OAuth consent screen also asks for a support email separately in Cloud Console — that's a different, required field this constant does not fill in. */
  contactEmail: "sunghokimjkh@gmail.com" as string | null,

  /** Separate legal-notices address (e.g. for takedown/legal process), if different from contactEmail. Not currently referenced by either page; add a render site if/when the operator wants it surfaced separately. */
  legalEmail: process.env.LEGAL_NOTICE_EMAIL || null,

  /** Governing law / venue for disputes, e.g. "the laws of the State of Delaware, USA, without regard to conflict-of-laws rules." Purely optional — omitted from Terms entirely when unset, rather than described as missing (see file header). */
  governingLaw: process.env.LEGAL_GOVERNING_LAW || null,

  /** Dispute-resolution clause (arbitration, small-claims carve-out, class-action waiver, etc.), if the operator wants one. A real clause needs a lawyer — this is not filled in speculatively. Omitted from Terms entirely when unset. */
  disputeResolution: process.env.LEGAL_DISPUTE_RESOLUTION || null,
} as const
