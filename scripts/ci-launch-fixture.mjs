// Compile/test fixture ONLY. Never deploy an artifact built with these values.
const categories = Object.fromEntries(["friendMessages", "friendRequests", "recentMatches", "reports", "reportEvidence", "moderationActions", "appeals", "cybertiplineCases", "imageChecks", "legalAcceptance", "privacyOperations", "accountTombstones", "storedImages", "heldRecords", "securityLogs", "infrastructureLogs", "backups"].map(category => [category, {
  mode: ["securityLogs", "infrastructureLogs", "backups"].includes(category) ? "external" : category === "accountTombstones" ? "review" : "automatic",
  days: 1, reason: "CI fixture, not an operator retention decision",
}]))
export const ciLaunchFixture = {
  LEGAL_OPERATOR_NAME: "CI compile fixture — not an operator", LEGAL_OPERATOR_ADDRESS: "CI fixture — not a legal address",
  PRIVACY_CONTACT_EMAIL: "ci@example.invalid", LEGAL_NOTICE_EMAIL: "ci@example.invalid",
  LEGAL_DEPLOYMENT_DISCLOSURE: "CI only; no real providers or processing regions",
  // Approval values remain false. RIZZUNO_CI_COMPILE_ONLY bypasses them only
  // for a synthetic compile and can never make this fixture launch-ready.
  LEGAL_REVIEW_APPROVED: "false", SAFETY_WORKFLOW_APPROVED: "false", RETENTION_SCHEDULER_CONFIRMED: "false",
  LAUNCH_REVIEW_REFERENCE: "ci-fixture", ADMIN_EMAILS: "ci@example.invalid", SAFETY_REVIEWER_EMAILS: "ci@example.invalid",
  SUPPORTED_COUNTRIES: "US", SUPPORTED_US_REGIONS: "", LAUNCH_GEO_SOURCE: "vercel",
  PROVIDER_REGION_DISCLOSURE_REVIEWED: "false", TRAINED_SAFETY_REVIEWERS_CONFIRMED: "false",
  UNDER13_RESPONSE_PROCEDURE_APPROVED: "false", CYBERTIPLINE_PROCEDURE_APPROVED: "false", BREACH_RESPONSE_APPROVED: "false", US_STATE_LAUNCH_REVIEW_APPROVED: "false",
  RECENT_MATCH_REPORT_WINDOW_HOURS: "24",
  DMCA_512_RELIANCE: "false", DMCA_AGENT_REGISTERED: "false", DMCA_AGENT_NAME: "CI fixture", DMCA_AGENT_ADDRESS: "CI fixture", DMCA_AGENT_PHONE: "CI fixture", DMCA_REGISTRATION_REFERENCE: "CI fixture — no registration",
  RETENTION_POLICY_JSON: JSON.stringify({ approvedBy: "CI fixture", caseReference: "ci-fixture", reviewBy: "2099-01-01", categories }),
}
