import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { NextRequest, NextResponse } from "next/server"
import { AGE_ELIGIBILITY_COOKIE, readEligibilityToken } from "../lib/preAuthEligibility.ts"
import { verifyTicket, realtimeAgeAllowed } from "../lib/realtimeTicket.ts"

const jar = new Map<string, string>()
let accepted = true, banned = false, recorded = 0, limited = false
mock.module("next/headers", { exports: { cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined }) } })
mock.module("@/auth", { exports: { auth: async () => ({ user: { id: "test-account" } }) } })
mock.module("@/lib/apiRateLimit", { exports: { isRateLimited: async () => limited } })
mock.module("@/lib/db", { exports: { getUserStatus: async () => ({ banned, deleted: false }), hasAcceptedCurrent: async () => accepted, recordAcceptance: async () => { recorded++ }, describeDbError: () => ({}) } })
const gate = await import("../app/api/eligibility/route.ts")
const assurance = await import("../app/api/eligibility/assurance/route.ts")
const legal = await import("../app/api/legal/accept/route.ts")
const ticket = await import("../app/api/realtime/ticket/route.ts")
const { proxy } = await import("../proxy.ts")
const origin = "https://rizzuno.test"
const review = { mode: "self_attestation", minimumAge: 18, reference: "test only", reviewBy: "2099-01-01" }

function request(path: string, body?: unknown, sameOrigin = true) {
  return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "NY", ...(sameOrigin ? { origin } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function applyCookies(response: Awaited<ReturnType<typeof gate.POST>>) {
  assert.ok(response instanceof NextResponse)
  for (const cookie of response.cookies.getAll()) {
    if (cookie.maxAge === 0) jar.delete(cookie.name)
    else jar.set(cookie.name, cookie.value)
  }
}
function configure(mode = "self_attestation") {
  jar.clear(); accepted = true; banned = false; recorded = 0; limited = false
  Object.assign(process.env, { AUTH_SECRET: "age-test-secret-at-least-thirty-two-chars", REALTIME_TICKET_SECRET: "test-realtime-secret", APP_URL: origin, VERCEL: "1", SUPPORTED_COUNTRIES: "US", SUPPORTED_US_REGIONS: "NY", DATABASE_URL: "postgres://unused.invalid/test", AGE_POLICIES_JSON: JSON.stringify({ "US-NY": { ...review, mode } }) })
}

test("unchecked, missing, legacy, and forged age claims cannot grant access; success preserves OAuth and matchmaking", async () => {
  configure()
  for (const body of [{}, { confirmedAdult: false }, { confirmedAdult: "true" }, { dateOfBirth: "1990-01-01", meetsHigherLocalAge: true }, { verified: true }]) {
    const denied = await gate.POST(request("/api/eligibility", body))
    assert.equal(denied.status, 403); applyCookies(denied)
    assert.equal(jar.has(AGE_ELIGIBILITY_COOKIE), false)
  }
  assert.equal((await gate.POST(request("/api/eligibility", { confirmedAdult: true }, false))).status, 403)
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
  assert.equal((await legal.POST(request("/api/legal/accept", { confirmedAdult: true, acceptTerms: true }))).status, 403)
  const success = await gate.POST(request("/api/eligibility", { confirmedAdult: true }))
  assert.equal(success.status, 200); applyCookies(success)
  assert.ok(success instanceof NextResponse)
  const cookie = success.cookies.get(AGE_ELIGIBILITY_COOKIE)!
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "lax"); assert.equal(cookie.path, "/")
  assert.equal((await readEligibilityToken(cookie.value))?.method, "self_attestation")
  assert.equal((await gate.GET(request("/api/eligibility"))).headers.get("cache-control"), "no-store")
  const oauth = new NextRequest(request("/api/auth/callback/google"), { headers: { ...Object.fromEntries(request("/").headers), cookie: `${AGE_ELIGIBILITY_COOKIE}=${cookie.value}` } })
  assert.equal((await proxy(oauth)).status, 200)
  assert.equal((await legal.POST(request("/api/legal/accept", {}))).status, 400)
  assert.equal((await legal.POST(request("/api/legal/accept", { confirmedAdult: true, acceptTerms: true }))).status, 200)
  assert.equal(recorded, 1)
  const issued = await ticket.GET(request("/api/realtime/ticket"))
  assert.equal(issued.status, 200)
  const issuedToken = (await issued.json()).ticket
  const access = verifyTicket(issuedToken)!
  assert.equal(access.userId, "test-account"); assert.equal(access.usRegion, "NY")
  assert.equal(realtimeAgeAllowed({ ...access, ageExpiresAt: Date.now() - 1 }), false)
  accepted = false
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
  accepted = true; banned = true
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
  process.env.AGE_POLICIES_JSON = JSON.stringify({ "US-NY": { ...review, mode: "provider" } })
  assert.equal(verifyTicket(issuedToken), null)
  assert.equal(realtimeAgeAllowed(access), false)
  assert.equal((await gate.GET(request("/api/eligibility"))).status, 200)
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
})

test("required assurance fails closed and trusts only a browser-bound authenticated provider result", async () => {
  configure("provider")
  delete process.env.AGE_ASSURANCE_API_URL
  assert.equal((await gate.POST(request("/api/eligibility", { confirmedAdult: true }))).status, 503)
  Object.assign(process.env, { AGE_ASSURANCE_API_URL: "https://assurance.invalid/api", AGE_ASSURANCE_API_KEY: "test-provider-key", AGE_ASSURANCE_PROVIDER_NAME: "Test Provider", AGE_ASSURANCE_PRIVACY_URL: "https://assurance.invalid/privacy", AGE_ASSURANCE_REDIRECT_ORIGIN: "https://assurance.invalid" })
  let session: Record<string, unknown> = {}, result: Record<string, unknown> = { status: "pending" }, badRedirect = false
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-provider-key")
    assert.equal(init?.redirect, "error")
    const body = JSON.parse(String(init?.body))
    if (String(url).endsWith("/sessions")) {
      session = body
      assert.deepEqual(Object.keys(body).sort(), ["jurisdiction", "minimumAge", "reference", "returnUrl"])
      return Response.json({ transactionId: "transaction-1", redirectUrl: badRedirect ? "https://evil.invalid/" : "https://assurance.invalid/check" })
    }
    assert.equal(body.reference, session.reference)
    return Response.json({ reference: session.reference, transactionId: "transaction-1", minimumAge: 18, jurisdiction: "US-NY", ...result })
  })
  try {
    badRedirect = true
    assert.equal((await gate.POST(request("/api/eligibility", { confirmedAdult: true }))).status, 503)
    badRedirect = false
    const start = await gate.POST(request("/api/eligibility", { confirmedAdult: true }))
    assert.equal((await start.json()).assuranceRequired, true); applyCookies(start)
    const pendingCookie = [...jar.entries()][0]
    assert.equal(jar.has(AGE_ELIGIBILITY_COOKIE), false)
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", { verified: true }))).status, 409)
    jar.clear()
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", { verified: true }))).status, 403)
    jar.set(pendingCookie[0], `${pendingCookie[1]}x`)
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", {}))).status, 403)
    jar.set(...pendingCookie)
    result = { status: "passed", meetsMinimumAge: true, reference: "another-browser", expiresAt: Date.now() + 60_000 }
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", {}))).status, 503)
    result = { status: "passed", meetsMinimumAge: true, expiresAt: Date.now() - 1 }
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", {}))).status, 503)
    result = { status: "passed", meetsMinimumAge: true, expiresAt: Date.now() + 60_000 }
    const success = await assurance.POST(request("/api/eligibility/assurance", {}))
    assert.equal(success.status, 200); applyCookies(success)
    assert.equal((await readEligibilityToken(jar.get(AGE_ELIGIBILITY_COOKIE)))?.method, "provider")
    assert.equal(jar.has(pendingCookie[0]), false)
    assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 200)
    assert.equal((await assurance.POST(request("/api/eligibility/assurance", {}))).status, 403)
    limited = true
    assert.equal((await gate.POST(request("/api/eligibility", { confirmedAdult: true }))).status, 429)
  } finally { fetchMock.mock.restore() }
})
