import { billingMode } from "./billingMode"
import { databaseConfig } from "./dbConfig"
import { imageStorageConfig } from "./imageStorage"

function url(name: string, protocols: string[]): URL {
  try {
    const value = new URL(process.env[name]!)
    if (!protocols.includes(value.protocol) || !value.hostname || value.username || value.password || value.hash) throw new Error()
    return value
  } catch { throw new Error(`Invalid configuration: ${name}`) }
}
export function validateProductionConfig(role: "web" | "realtime") {
  if (process.env.NODE_ENV !== "production") return
  billingMode()
  const required = role === "web"
    ? ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_URL", "APP_URL", "DATABASE_URL", "REALTIME_TICKET_SECRET", "NEXT_PUBLIC_WS_URL", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET", "NEXT_PUBLIC_TURN_URL", "TURN_STATIC_AUTH_SECRET"]
    : ["DATABASE_URL", "REALTIME_TICKET_SECRET", "ALLOWED_WS_ORIGINS", "REDIS_URL", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"]
  for (const key of required) if (!process.env[key]?.trim()) throw new Error(`Missing required configuration: ${key}`)
  try {
    const db = new URL(process.env.DATABASE_URL!)
    if (!db.hostname || !db.username || db.pathname.length < 2) throw new Error()
    databaseConfig(process.env.DATABASE_URL!)
  } catch { throw new Error("Invalid configuration: DATABASE_URL or DATABASE_SSL_CA") }
  if (process.env.DATABASE_SSL_CA_REQUIRED === "true" && !process.env.DATABASE_SSL_CA) throw new Error("Missing required configuration: DATABASE_SSL_CA")
  if (process.env.REALTIME_TICKET_SECRET!.length < 32 || process.env.REALTIME_TICKET_SECRET === process.env.AUTH_SECRET) throw new Error("Realtime signing key must be strong and separate")
  if (role === "web") {
    if (process.env.AUTH_SECRET!.length < 32) throw new Error("Invalid configuration: AUTH_SECRET")
    if (url("AUTH_URL", ["https:"]).origin !== url("APP_URL", ["https:"]).origin) throw new Error("AUTH_URL and APP_URL origins must match")
    url("NEXT_PUBLIC_WS_URL", ["wss:"])
    imageStorageConfig()
  }
  if (role === "realtime") {
    // Redis authentication is permitted, but never included in diagnostics.
    let redisUrl: URL
    try { redisUrl = new URL(process.env.REDIS_URL!) } catch { throw new Error("Invalid configuration: REDIS_URL") }
    if (redisUrl.protocol !== "rediss:" && !(redisUrl.protocol === "redis:" && redisUrl.hostname.endsWith(".railway.internal"))) throw new Error("Production Redis must use TLS or Railway private networking")
    for (const origin of process.env.ALLOWED_WS_ORIGINS!.split(",")) {
      try { const u = new URL(origin.trim()); if (u.protocol !== "https:" || u.origin !== origin.trim()) throw new Error() }
      catch { throw new Error("Invalid configuration: ALLOWED_WS_ORIGINS") }
    }
  }
  if (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || process.env.NEXT_PUBLIC_TURN_USERNAME) throw new Error("Permanent public TURN credentials are forbidden in production")
  if (process.env.NEXT_PUBLIC_TURN_URL) {
    if (!process.env.TURN_STATIC_AUTH_SECRET) throw new Error("TURN shared secret required")
    for (const endpoint of process.env.NEXT_PUBLIC_TURN_URL.split(",")) {
      if (!/^turns?:[a-zA-Z0-9.-]+(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(endpoint.trim())) throw new Error("Invalid configuration: NEXT_PUBLIC_TURN_URL")
    }
  }
}
