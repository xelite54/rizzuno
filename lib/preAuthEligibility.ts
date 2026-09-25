const VERSION = "2026-09-25"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export const AGE_ELIGIBILITY_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-rizzuno-age-eligibility"
  : "rizzuno-age-eligibility"
export const AGE_ELIGIBILITY_VERSION = VERSION

type EligibilityClaim = { eligible: boolean; checkedAt: number; version: string }

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

async function signature(payload: string, env?: Record<string, string | undefined>) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`rizzuno-pre-oauth-age:${secret(env)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")
}

export async function createEligibilityToken(eligible: boolean, checkedAt = Date.now(), env?: Record<string, string | undefined>) {
  const payload = encode(JSON.stringify({ eligible, checkedAt, version: VERSION } satisfies EligibilityClaim))
  return `${payload}.${await signature(payload, env)}`
}

export async function readEligibilityToken(token: string | undefined, now = Date.now(), env?: Record<string, string | undefined>): Promise<EligibilityClaim | null> {
  if (!token) return null
  const [payload, supplied, extra] = token.split(".")
  if (!payload || !supplied || extra) return null
  // Web Crypto performs the MAC comparison inside verify(), avoiding a
  // JavaScript string comparison for authentication data.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`rizzuno-pre-oauth-age:${secret(env)}`), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  if (!await crypto.subtle.verify("HMAC", key, Buffer.from(supplied, "base64url"), new TextEncoder().encode(payload))) return null
  try {
    const claim = JSON.parse(decode(payload)) as Partial<EligibilityClaim>
    if (claim.version !== VERSION || typeof claim.eligible !== "boolean" || !Number.isSafeInteger(claim.checkedAt)) return null
    if (claim.checkedAt! > now + 60_000 || now - claim.checkedAt! > MAX_AGE_MS) return null
    return claim as EligibilityClaim
  } catch { return null }
}

export function evaluateDateOfBirth(value: unknown, meetsHigherLocalAge: unknown, today = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || meetsHigherLocalAge !== true) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false
  const currentYear = today.getUTCFullYear()
  let age = currentYear - year
  if (today.getUTCMonth() < month - 1 || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day)) age--
  return age >= 18 && age <= 120
}

export const AGE_ELIGIBILITY_MAX_AGE_SECONDS = MAX_AGE_MS / 1000
