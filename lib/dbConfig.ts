import type { PoolConfig } from "pg"
import { rootCertificates } from "node:tls"

function integer(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}`)
  return n
}

export function databaseConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString)
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database protocol")
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  // pg connection-string SSL options can override the explicit ssl object.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key)
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n")
  if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Invalid DATABASE_SSL_CA")
  return {
    connectionString: url.toString(),
    ssl: local && process.env.NODE_ENV !== "production"
      ? false
      : {
          rejectUnauthorized: true,
          ...(ca ? { ca: [ca, ...rootCertificates] } : {}),
        },
    max: integer("DATABASE_POOL_MAX", process.env.VERCEL ? 2 : 10, 50),
    idleTimeoutMillis: integer("DATABASE_IDLE_TIMEOUT_MS", 10_000, 300_000),
    connectionTimeoutMillis: integer("DATABASE_CONNECT_TIMEOUT_MS", 5_000, 30_000),
    statement_timeout: integer("DATABASE_STATEMENT_TIMEOUT_MS", 15_000, 120_000),
    query_timeout: integer("DATABASE_QUERY_TIMEOUT_MS", 20_000, 150_000),
    application_name: process.env.VERCEL ? "rizzuno-web" : "rizzuno-realtime",
  }
}
