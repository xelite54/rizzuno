import type { AgePolicy } from "./agePolicy"

/** Server-to-server bridge contract. Operator must connect a real reviewed
 * service; no vendor or verification method is enabled by default. */
export function ageAssuranceConfig(env: Record<string, string | undefined> = process.env) {
  const { AGE_ASSURANCE_API_URL: raw, AGE_ASSURANCE_API_KEY: apiKey, AGE_ASSURANCE_PROVIDER_NAME: name, AGE_ASSURANCE_PRIVACY_URL: privacy, AGE_ASSURANCE_REDIRECT_ORIGIN: origin } = env
  if (!raw || !apiKey || !name || !privacy || !origin) return null
  try {
    const url = new URL(raw), privacyUrl = new URL(privacy), redirect = new URL(origin)
    if ([url, privacyUrl, redirect].some(value => value.protocol !== "https:" || value.username || value.password) || redirect.origin !== origin || url.search || url.hash) return null
    return { url: url.href.replace(/\/$/, ""), apiKey, name, privacyUrl: privacyUrl.href, redirectOrigin: origin }
  } catch { return null }
}
export function ageAssuranceCapability() {
  const config = ageAssuranceConfig()
  return { state: config ? "configured" : "not configured", provider: config?.name ?? null, currentGate: "self_attestation_with_jurisdiction_policy" }
}
async function providerRequest(path: string, body: Record<string, unknown>) {
  const config = ageAssuranceConfig()
  if (!config) throw new Error("age_assurance_unavailable")
  const response = await fetch(`${config.url}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("age_assurance_unavailable")
  return await response.json() as Record<string, unknown>
}
export async function beginAgeAssurance(policy: AgePolicy, reference: string, returnUrl: string) {
  const data = await providerRequest("/sessions", { reference, minimumAge: policy.minimumAge, jurisdiction: policy.jurisdiction, returnUrl })
  if (typeof data.transactionId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(data.transactionId) || typeof data.redirectUrl !== "string") throw new Error("invalid_provider_response")
  const target = new URL(data.redirectUrl)
  if (target.origin !== ageAssuranceConfig()!.redirectOrigin || target.username || target.password) throw new Error("invalid_provider_redirect")
  return { transactionId: data.transactionId, redirectUrl: target.href }
}
export async function completeAgeAssurance(policy: AgePolicy, reference: string, transactionId: string, now = Date.now()) {
  // Only an authenticated remote result grants access; browser claims and
  // successful redirects never constitute proof.
  const data = await providerRequest("/sessions/result", { transactionId, reference })
  if (data.transactionId !== transactionId || data.reference !== reference || data.minimumAge !== policy.minimumAge || data.jurisdiction !== policy.jurisdiction) throw new Error("invalid_provider_binding")
  if (data.status === "pending") return { status: "pending" as const }
  if (data.status !== "passed" || data.meetsMinimumAge !== true) return { status: "denied" as const }
  if (!Number.isSafeInteger(data.expiresAt) || Number(data.expiresAt) <= now) throw new Error("expired_provider_result")
  return { status: "passed" as const, expiresAt: Math.min(Number(data.expiresAt), now + 86_400_000, Date.parse(policy.reviewBy)) }
}
