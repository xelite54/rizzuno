/** Remote load is opt-in, bounded, and restricted to explicitly named staging hosts. */
export function stagingTargets(env: Record<string, string | undefined> = process.env) {
  if (env.LOAD_ENVIRONMENT !== "staging" || env.LOAD_WRITES_APPROVED !== "true") throw new Error("Explicit staging/write approval required")
  const web = new URL(env.STAGING_HTTP_ORIGIN ?? "")
  const ws = new URL(env.STAGING_WS_URL ?? "")
  for (const target of [web,ws]) {
    if (!target.hostname.split(/[.-]/).includes("staging") || target.username || target.password || target.hash || target.search) throw new Error("Only dedicated staging hostnames are permitted")
  }
  if (web.protocol!=="https:" || web.origin!==env.STAGING_HTTP_ORIGIN || ws.protocol!=="wss:" || env.STAGING_TARGET_ACK!==web.origin) throw new Error("Staging target acknowledgement mismatch")
  if (!env.STAGING_PROBE_SECRET || env.STAGING_PROBE_SECRET.length<32) throw new Error("Staging probe secret required")
  return { web, ws }
}
