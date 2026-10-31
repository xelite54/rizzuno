import type { AgePolicy } from "./agePolicy"

const VERSION = "2026-10-30"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export const AGE_ELIGIBILITY_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-rizzuno-age-eligibility"
  : "rizzuno-age-eligibility"
export const AGE_ELIGIBILITY_VERSION = VERSION

export type EligibilityClaim = { eligible: boolean; checkedAt: number; version: string; method: "self_attestation" | "provider"; policyKey: string; minimumAge: number; expiresAt: number }

function secret(env: Record<string, string | undefined> = process.env) {
  const value = env.AUTH_SECRET?.trim()
  if (!value) throw new Error("AUTH_SECRET is required for age eligibility")
  return value
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url")
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}

async function signature(payload: string, env?: Record<string, string | undefined>, purpose = "eligibility") {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`rizzuno-pre-oauth-age:${purpose}:${secret(env)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")
}

export async function createEligibilityToken(eligible: boolean, checkedAt = Date.now(), env?: Record<string, string | undefined>, details?: Pick<EligibilityClaim, "method" | "policyKey" | "minimumAge" | "expiresAt">) {
  const payload = encode(JSON.stringify({ eligible, checkedAt, version: VERSION, method: "self_attestation", policyKey: "development", minimumAge: 18, expiresAt: checkedAt + MAX_AGE_MS, ...details } satisfies EligibilityClaim))
  return `${payload}.${await signature(payload, env)}`
}

export async function readEligibilityToken(token: string | undefined, now = Date.now(), env?: Record<string, string | undefined>): Promise<EligibilityClaim | null> {
  if (!token || token.length > 4096) return null
  const [payload, supplied, extra] = token.split(".")
  if (!payload || !supplied || extra) return null
  // Web Crypto performs the MAC comparison inside verify(), avoiding a
  // JavaScript string comparison for authentication data.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`rizzuno-pre-oauth-age:eligibility:${secret(env)}`), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  if (!await crypto.subtle.verify("HMAC", key, Buffer.from(supplied, "base64url"), new TextEncoder().encode(payload))) return null
  try {
    const claim = JSON.parse(decode(payload)) as Partial<EligibilityClaim>
    if (claim.version !== VERSION || typeof claim.eligible !== "boolean" || !Number.isSafeInteger(claim.checkedAt)) return null
    if (claim.checkedAt! > now + 60_000 || now - claim.checkedAt! > MAX_AGE_MS) return null
    if (!["self_attestation", "provider"].includes(claim.method ?? "") || typeof claim.policyKey !== "string" ||
      !Number.isSafeInteger(claim.minimumAge) || claim.minimumAge! < 18 || !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt! <= now || claim.expiresAt! > claim.checkedAt! + MAX_AGE_MS) return null
    return claim as EligibilityClaim
  } catch { return null }
}

export function eligibilitySatisfies(claim: EligibilityClaim | null, policy: AgePolicy | null) {
  return !!claim?.eligible && !!policy && policy.mode !== "unavailable" && claim.policyKey === policy.key &&
    claim.minimumAge >= policy.minimumAge && (policy.mode !== "provider" || claim.method === "provider") && claim.expiresAt > Date.now()
}

// Separate signing domain: a pending provider transaction cannot be used as eligibility.
export async function signAgeChallenge(value: Record<string, unknown>) {
  const payload = encode(JSON.stringify(value))
  return `${payload}.${await signature(payload, undefined, "challenge")}`
}
export async function readAgeChallenge(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!token || token.length > 4096) return null
  const [payload, supplied, extra] = token.split(".")
  if (!payload || !supplied || extra) return null
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`rizzuno-pre-oauth-age:challenge:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  if (!await crypto.subtle.verify("HMAC", key, Buffer.from(supplied, "base64url"), new TextEncoder().encode(payload))) return null
  try { return JSON.parse(decode(payload)) } catch { return null }
}

export const AGE_ELIGIBILITY_MAX_AGE_SECONDS = MAX_AGE_MS / 1000
