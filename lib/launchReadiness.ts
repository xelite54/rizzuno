import { normalizeCountry, normalizeUsRegion } from "./country"
import { retentionPolicy } from "./retention"
import { recentMatchReportWindowMs } from "./recentMatches"

export function supportedCountries(env: Record<string, string | undefined> = process.env): string[] {
  const values = (env.SUPPORTED_COUNTRIES ?? "").split(",").map(value => value.trim()).filter(Boolean)
  if (!values.length || values.some(value => !normalizeCountry(value) || value !== value.toUpperCase())) throw new Error("Invalid configuration: SUPPORTED_COUNTRIES")
  return [...new Set(values)]
}
export function countryAllowed(country: string | null, env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== "production" && !env.SUPPORTED_COUNTRIES) return true
  return country !== null && supportedCountries(env).includes(country)
}
export function supportedUsRegions(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.SUPPORTED_US_REGIONS?.trim()
  if (!raw) return []
  const values = raw.split(",").map(value => value.trim())
  if (values.some(value => !normalizeUsRegion(value) || value !== value.toUpperCase())) throw new Error("Invalid configuration: SUPPORTED_US_REGIONS")
  return [...new Set(values)]
}
export function locationAllowed(country: string | null, usRegion: string | null, env: Record<string, string | undefined> = process.env) {
  if (!countryAllowed(country, env)) return false
  const regions = supportedUsRegions(env)
  if (country !== "US") return true
  // Production U.S. access has no implicit nationwide fallback. The operator
  // must explicitly list each reviewed state/DC region.
  if (!regions.length) return env.NODE_ENV !== "production"
  return usRegion !== null && regions.includes(usRegion)
}
/** Run for both production services and before release. Never prints secret values. */
export function validateLaunchReadiness(env: Record<string, string | undefined> = process.env) {
  const compileOnlyFixture = env.RIZZUNO_CI_COMPILE_ONLY === "true" && env.CI === "true" && env.LEGAL_OPERATOR_NAME === "CI compile fixture — not an operator"
  for (const key of ["LEGAL_OPERATOR_NAME", "LEGAL_OPERATOR_ADDRESS", "LEGAL_DEPLOYMENT_DISCLOSURE", "LAUNCH_REVIEW_REFERENCE", "ADMIN_EMAILS", "SAFETY_REVIEWER_EMAILS"]) {
    if (!env[key]?.trim()) throw new Error(`Missing launch configuration: ${key}`)
  }
  for (const key of ["PRIVACY_CONTACT_EMAIL", "LEGAL_NOTICE_EMAIL"]) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[key] ?? "")) throw new Error(`Invalid configuration: ${key}`)
  }
  if (env.COPYRIGHT_NOTICE_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.COPYRIGHT_NOTICE_EMAIL)) throw new Error("Invalid configuration: COPYRIGHT_NOTICE_EMAIL")
  if ((env.LEGAL_REVIEW_APPROVED !== "true" || env.SAFETY_WORKFLOW_APPROVED !== "true" || env.RETENTION_SCHEDULER_CONFIRMED !== "true") && !compileOnlyFixture) throw new Error("Operator legal, safety and retention scheduler approvals required")
  if ((env.LEGAL_GOVERNING_LAW || env.LEGAL_DISPUTE_RESOLUTION) && env.LEGAL_TERMS_REVIEWED !== "true") throw new Error("Optional dispute terms require legal review")
  const countries = supportedCountries(env)
  if (countries.includes("US")) {
    if (!compileOnlyFixture && !supportedUsRegions(env).length) throw new Error("US launch requires an explicit reviewed SUPPORTED_US_REGIONS allowlist")
    if (!compileOnlyFixture && !["true", "false"].includes(env.DMCA_512_RELIANCE ?? "")) throw new Error("US launch requires an explicit DMCA_512_RELIANCE decision")
    if (env.DMCA_512_RELIANCE === "true") {
      if (env.DMCA_AGENT_REGISTERED !== "true" && !compileOnlyFixture) throw new Error("External DMCA agent registration confirmation required when relying on 17 U.S.C. §512")
      for (const key of ["DMCA_AGENT_NAME", "DMCA_AGENT_ADDRESS", "DMCA_AGENT_PHONE", "DMCA_REGISTRATION_REFERENCE"]) if (!env[key]?.trim()) throw new Error(`Missing launch configuration: ${key}`)
    }
    for (const key of ["PROVIDER_REGION_DISCLOSURE_REVIEWED", "TRAINED_SAFETY_REVIEWERS_CONFIRMED", "UNDER13_RESPONSE_PROCEDURE_APPROVED", "CYBERTIPLINE_PROCEDURE_APPROVED", "BREACH_RESPONSE_APPROVED", "US_STATE_LAUNCH_REVIEW_APPROVED"]) {
      if (env[key] !== "true" && !compileOnlyFixture) throw new Error(`US launch operator approval required: ${key}`)
    }
  }
  const regions = supportedUsRegions(env)
  if (regions.length && !countries.includes("US")) throw new Error("SUPPORTED_US_REGIONS requires US in SUPPORTED_COUNTRIES")
  if (env.LAUNCH_GEO_SOURCE !== "vercel") throw new Error("Configure reviewed trusted geolocation: LAUNCH_GEO_SOURCE=vercel")
  recentMatchReportWindowMs(env)
  retentionPolicy(env)
}
