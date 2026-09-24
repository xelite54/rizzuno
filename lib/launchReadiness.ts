import { normalizeCountry } from "./country"
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
/** Run for both production services and before release. Never prints secret values. */
export function validateLaunchReadiness(env: Record<string, string | undefined> = process.env) {
  for (const key of ["LEGAL_OPERATOR_NAME", "LEGAL_OPERATOR_ADDRESS", "LEGAL_DEPLOYMENT_DISCLOSURE", "LAUNCH_REVIEW_REFERENCE", "ADMIN_EMAILS", "SAFETY_REVIEWER_EMAILS"]) {
    if (!env[key]?.trim()) throw new Error(`Missing launch configuration: ${key}`)
  }
  for (const key of ["PRIVACY_CONTACT_EMAIL", "LEGAL_NOTICE_EMAIL"]) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[key] ?? "")) throw new Error(`Invalid configuration: ${key}`)
  }
  if (env.COPYRIGHT_NOTICE_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.COPYRIGHT_NOTICE_EMAIL)) throw new Error("Invalid configuration: COPYRIGHT_NOTICE_EMAIL")
  if (env.LEGAL_REVIEW_APPROVED !== "true" || env.SAFETY_WORKFLOW_APPROVED !== "true" || env.RETENTION_SCHEDULER_CONFIRMED !== "true") throw new Error("Operator legal, safety and retention scheduler approvals required")
  if ((env.LEGAL_GOVERNING_LAW || env.LEGAL_DISPUTE_RESOLUTION) && env.LEGAL_TERMS_REVIEWED !== "true") throw new Error("Optional dispute terms require legal review")
  const countries = supportedCountries(env)
  if (countries.includes("US")) {
    if (env.DMCA_AGENT_REGISTERED !== "true") throw new Error("US launch requires external DMCA agent registration confirmation")
    for (const key of ["DMCA_AGENT_NAME", "DMCA_AGENT_ADDRESS", "DMCA_AGENT_PHONE", "DMCA_REGISTRATION_REFERENCE"]) if (!env[key]?.trim()) throw new Error(`Missing launch configuration: ${key}`)
  }
  if (env.LAUNCH_GEO_SOURCE !== "vercel") throw new Error("Configure reviewed trusted geolocation: LAUNCH_GEO_SOURCE=vercel")
  recentMatchReportWindowMs(env)
  retentionPolicy(env)
}
