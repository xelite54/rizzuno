import { billingMode } from "./billingMode"

export function validateProductionConfig(role: "web" | "realtime") {
  if (process.env.NODE_ENV !== "production") return
  billingMode()
  const required = role === "web"
    ? ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_URL", "APP_URL", "DATABASE_URL", "REALTIME_TICKET_SECRET", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"]
    : ["DATABASE_URL", "REALTIME_TICKET_SECRET", "ALLOWED_WS_ORIGINS", "REDIS_URL", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"]
  for (const key of required) if (!process.env[key]) throw new Error(`Missing required configuration: ${key}`)
  if (process.env.REALTIME_TICKET_SECRET!.length < 32 || process.env.REALTIME_TICKET_SECRET === process.env.AUTH_SECRET) throw new Error("Realtime signing key must be strong and separate")
  if (role === "web" && (process.env.AUTH_SECRET!.length < 32 || new URL(process.env.AUTH_URL!).origin !== new URL(process.env.APP_URL!).origin)) throw new Error("Invalid authentication configuration")
  for (const name of ["APP_URL", "AUTH_URL"]) if (process.env[name] && new URL(process.env[name]!).protocol !== "https:") throw new Error(`HTTPS required: ${name}`)
  if (role === "realtime" && new URL(process.env.REDIS_URL!).protocol !== "rediss:") throw new Error("Production Redis requires TLS")
  if (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || process.env.NEXT_PUBLIC_TURN_USERNAME) throw new Error("Permanent public TURN credentials are forbidden in production")
  if (process.env.NEXT_PUBLIC_TURN_URL && !process.env.TURN_STATIC_AUTH_SECRET) throw new Error("TURN shared secret required")
}
