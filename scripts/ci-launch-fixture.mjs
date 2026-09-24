// Compile/test fixture ONLY. Never deploy an artifact built with these values.
const categories = Object.fromEntries(["friendMessages", "friendRequests", "recentMatches", "reports", "reportEvidence", "moderationActions", "appeals", "imageChecks", "legalAcceptance", "privacyOperations", "accountTombstones", "storedImages", "heldRecords", "securityLogs", "infrastructureLogs", "backups"].map(category => [category, {
  mode: ["securityLogs", "infrastructureLogs", "backups"].includes(category) ? "external" : category === "accountTombstones" ? "review" : "automatic",
  days: 1, reason: "CI fixture, not an operator retention decision",
}]))
export const ciLaunchFixture = {
  LEGAL_OPERATOR_NAME: "CI compile fixture — not an operator", LEGAL_OPERATOR_ADDRESS: "CI fixture — not a legal address",
  PRIVACY_CONTACT_EMAIL: "ci@example.invalid", LEGAL_NOTICE_EMAIL: "ci@example.invalid",
  LEGAL_DEPLOYMENT_DISCLOSURE: "CI only; no real providers or processing regions",
  LEGAL_REVIEW_APPROVED: "true", SAFETY_WORKFLOW_APPROVED: "true", RETENTION_SCHEDULER_CONFIRMED: "true",
  LAUNCH_REVIEW_REFERENCE: "ci-fixture", ADMIN_EMAILS: "ci@example.invalid", SAFETY_REVIEWER_EMAILS: "ci@example.invalid",
  SUPPORTED_COUNTRIES: "US", LAUNCH_GEO_SOURCE: "vercel",
  RECENT_MATCH_REPORT_WINDOW_HOURS: "24",
  DMCA_AGENT_REGISTERED: "true", DMCA_AGENT_NAME: "CI fixture", DMCA_AGENT_ADDRESS: "CI fixture", DMCA_AGENT_PHONE: "CI fixture", DMCA_REGISTRATION_REFERENCE: "CI fixture — no registration",
  RETENTION_POLICY_JSON: JSON.stringify({ approvedBy: "CI fixture", caseReference: "ci-fixture", reviewBy: "2099-01-01", categories }),
}
