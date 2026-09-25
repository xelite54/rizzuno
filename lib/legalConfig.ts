/** Public disclosures supplied by the actual operator. No speculative defaults. */
export const LEGAL_CONFIG = {
  operatorName: process.env.LEGAL_OPERATOR_NAME?.trim() || null,
  operatorAddress: process.env.LEGAL_OPERATOR_ADDRESS?.trim() || null,
  contactEmail: process.env.PRIVACY_CONTACT_EMAIL?.trim() || null,
  legalEmail: process.env.LEGAL_NOTICE_EMAIL?.trim() || null,
  copyrightEmail: process.env.COPYRIGHT_NOTICE_EMAIL?.trim() || process.env.LEGAL_NOTICE_EMAIL?.trim() || null,
  deploymentDisclosure: process.env.LEGAL_DEPLOYMENT_DISCLOSURE?.trim() || null,
  governingLaw: process.env.LEGAL_TERMS_REVIEWED === "true" ? process.env.LEGAL_GOVERNING_LAW?.trim() || null : null,
  disputeResolution: process.env.LEGAL_TERMS_REVIEWED === "true" ? process.env.LEGAL_DISPUTE_RESOLUTION?.trim() || null : null,
  dmca512Reliance: process.env.DMCA_512_RELIANCE === "true",
  dmcaRegistered: process.env.DMCA_512_RELIANCE === "true" && process.env.DMCA_AGENT_REGISTERED === "true",
  dmcaAgentName: process.env.DMCA_AGENT_NAME?.trim() || null,
  dmcaAgentAddress: process.env.DMCA_AGENT_ADDRESS?.trim() || null,
  dmcaAgentPhone: process.env.DMCA_AGENT_PHONE?.trim() || null,
} as const
