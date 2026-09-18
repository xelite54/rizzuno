/** Cookie-authenticated mutations require an explicit, canonical Origin. */
export function isSameOrigin(request: Request): boolean {
  try {
    const expected = new URL(process.env.APP_URL ?? request.url)
    const raw = request.headers.get("origin")
    if (!raw || raw === "null") return false
    const actual = new URL(raw)
    return raw === actual.origin && actual.origin === expected.origin
      && (process.env.NODE_ENV !== "production" || expected.protocol === "https:")
  } catch { return false }
}

export function csrfGuard(request: Request): Response | null {
  return isSameOrigin(request) ? null : Response.json({ error: "invalid_origin" }, { status: 403 })
}

export function isAllowedWsOrigin(origin: string | undefined, host?: string): boolean {
  if (!origin) return process.env.NODE_ENV !== "production"
  try {
    const parsed = new URL(origin)
    if (parsed.origin !== origin) return false
    const allowed = (process.env.ALLOWED_WS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    if (allowed.length) return allowed.includes(origin)
    return process.env.NODE_ENV !== "production" && parsed.host === host
  } catch { return false }
}
