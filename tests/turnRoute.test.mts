import { test, mock } from "node:test"
import assert from "node:assert/strict"

// app/api/realtime/turn/route.ts's own distributed rate limiting — see
// lib/db.ts's checkAndIncrementTurnCredentialRateLimit for the actual
// Postgres-backed atomic upsert this mocks here (no live Postgres in this
// test environment — same established pattern as every other DB-backed
// route test in this suite, e.g. tests/freeRizzPlus.test.mts). What's
// under test in THIS file is the ROUTE's own contract: who it calls the
// limiter for, and — the part that actually matters for "authoritative
// across Vercel instances, fails closed on a DB outage" — what it does
// with each of the limiter's three possible outcomes (not limited,
// limited, threw).
let userId: string | null = "tester"
const rateLimitCalls: { userId: string; limit: number; windowMs: number }[] = []
let rateLimitOutcome: "ok" | "limited" | "throw" = "ok"

mock.module("../auth.ts", { namedExports: { auth: async () => (userId ? { user: { id: userId } } : null) } })
mock.module("../lib/db.ts", {
  namedExports: {
    checkAndIncrementTurnCredentialRateLimit: async (id: string, limit: number, windowMs: number) => {
      rateLimitCalls.push({ userId: id, limit, windowMs })
      if (rateLimitOutcome === "throw") throw new Error("simulated database outage")
      return rateLimitOutcome === "limited"
    },
    describeDbError: (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
  },
})

const { GET } = await import("../app/api/realtime/turn/route.ts")

const TURN_ENV_KEYS = ["NEXT_PUBLIC_TURN_URL", "TURN_STATIC_AUTH_SECRET"] as const
function withTurnConfigured(fn: () => Promise<void>) {
  const previous = TURN_ENV_KEYS.map((key) => process.env[key])
  process.env.NEXT_PUBLIC_TURN_URL = "turn:relay.example:3478"
  process.env.TURN_STATIC_AUTH_SECRET = "shared-secret"
  return fn().finally(() => {
    TURN_ENV_KEYS.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
  })
}

test("an unauthenticated request never even reaches the rate limiter", async () => {
  userId = null
  rateLimitCalls.length = 0
  const res = await GET()
  assert.equal(res.status, 401)
  assert.equal(rateLimitCalls.length, 0)
  userId = "tester"
})

test("the authenticated account id is the rate-limit key, at the documented ~20/minute policy", async () => {
  rateLimitCalls.length = 0
  rateLimitOutcome = "ok"
  userId = "specific-account-id"
  await GET()
  assert.equal(rateLimitCalls.length, 1)
  assert.equal(rateLimitCalls[0].userId, "specific-account-id")
  assert.equal(rateLimitCalls[0].limit, 20)
  assert.equal(rateLimitCalls[0].windowMs, 60_000)
  userId = "tester"
})

test("a genuinely rate-limited account gets 429 and no credential is minted", async () => {
  await withTurnConfigured(async () => {
    rateLimitOutcome = "limited"
    const res = await GET()
    assert.equal(res.status, 429)
    const body = await res.json()
    assert.equal(body.configured, undefined, "never mints a credential for a rate-limited request")
    assert.equal(res.headers.get("cache-control"), "no-store")
    rateLimitOutcome = "ok"
  })
})

test("a database failure during the rate-limit check fails CLOSED — 503, no credential minted, never unlimited issuance", async () => {
  await withTurnConfigured(async () => {
    rateLimitOutcome = "throw"
    const res = await GET()
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.configured, undefined, "a DB outage must never be read as \"not rate limited\"")
    rateLimitOutcome = "ok"
  })
})

test("not rate limited, TURN unconfigured: reports configured:false rather than an error", async () => {
  const previous = TURN_ENV_KEYS.map((key) => process.env[key])
  TURN_ENV_KEYS.forEach((key) => delete process.env[key])
  rateLimitOutcome = "ok"
  try {
    const res = await GET()
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { configured: false })
  } finally {
    TURN_ENV_KEYS.forEach((key, i) => { if (previous[i] !== undefined) process.env[key] = previous[i] })
  }
})

test("not rate limited, TURN configured: mints a real short-lived credential, with the documented TTL, never a permanent one", async () => {
  await withTurnConfigured(async () => {
    rateLimitOutcome = "ok"
    const res = await GET()
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.configured, true)
    assert.deepEqual(body.urls, ["turn:relay.example:3478"])
    assert.ok(typeof body.username === "string" && body.username.length > 0)
    assert.ok(typeof body.credential === "string" && body.credential.length > 0)
    assert.equal(body.ttlSeconds, 24 * 60 * 60, "24h TTL — see lib/turnCredentials.ts's own doc comment for why")
  })
})
