import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { NextRequest, NextResponse } from "next/server"
import { AGE_ELIGIBILITY_COOKIE, readEligibilityToken } from "../lib/preAuthEligibility.ts"
import { verifyTicket, realtimeAgeAllowed } from "../lib/realtimeTicket.ts"
import { COUNTRIES_ELIGIBLE_FOR_REVIEW, EXCLUDED_COUNTRIES } from "../lib/geographicAccess.ts"

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
const review = { status: "approved", mode: "self_attestation", minimumAge: 18, reference: "test only", reviewBy: "2099-01-01" }

function request(path: string, body?: unknown, sameOrigin = true) {
  return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-vercel-ip-country": "JP", "x-vercel-ip-country-region": "13", ...(sameOrigin ? { origin } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
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
  Object.assign(process.env, { AUTH_SECRET: "age-test-secret-at-least-thirty-two-chars", REALTIME_TICKET_SECRET: "test-realtime-secret", APP_URL: origin, VERCEL: "1", LAUNCH_GEO_SOURCE: "vercel", SUPPORTED_COUNTRIES: "JP", SUPPORTED_US_REGIONS: "", SUPPORTED_SUBDIVISIONS_JSON: "{}", DATABASE_URL: "postgres://unused.invalid/test", AGE_POLICIES_JSON: JSON.stringify({ "JP": { ...review, mode } }) })
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
  assert.equal(access.userId, "test-account"); assert.equal(access.subdivision, "13")
  assert.equal(realtimeAgeAllowed({ ...access, ageExpiresAt: Date.now() - 1 }), false)
  accepted = false
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
  accepted = true; banned = true
  assert.equal((await ticket.GET(request("/api/realtime/ticket"))).status, 403)
  process.env.AGE_POLICIES_JSON = JSON.stringify({ "JP": { ...review, mode: "provider" } })
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
    return Response.json({ reference: session.reference, transactionId: "transaction-1", minimumAge: 18, jurisdiction: "JP", ...result })
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

test("all excluded countries fail through product APIs, OAuth and direct eligibility/ticket handlers", async () => {
  configure()
  const allowed = await gate.POST(request("/api/eligibility", {confirmedAdult:true}))
  applyCookies(allowed)
  const cookie = `${AGE_ELIGIBILITY_COOKIE}=${jar.get(AGE_ELIGIBILITY_COOKIE)}`
  const paths = ["/", "/api/profile/me", "/api/eligibility", "/api/eligibility/assurance", "/api/realtime/ticket", "/api/realtime/turn", "/api/auth/signin/google", "/api/auth/callback/google", "/api/auth/session", "/api/legal/accept", "/_next/data/fake/index.json"]
  for (const country of EXCLUDED_COUNTRIES) {
    // Even a stale/incorrect deployment configuration and valid age cookie
    // cannot enable an excluded country.
    process.env.SUPPORTED_COUNTRIES = `JP,${country}`
    process.env.SKIP_LAUNCH_READINESS = "true"
    process.env.AGE_POLICIES_JSON = JSON.stringify({JP:review,[country]:review})
    for (const path of paths) {
      const req = new NextRequest(`${origin}${path}?country=JP`,{headers:{"x-vercel-ip-country":country,"x-vercel-ip-country-region":"13","x-country":"JP",cookie}})
      const response = await proxy(req)
      assert.equal(response.status,451,`${country} ${path}`)
      assert.match(await response.text(),/Rizzuno is unavailable in your region/)
      assert.match(response.headers.get("cache-control")!,/no-store/)
    }
    const blocked = (path: string, body?: unknown) => {
      const req = request(path,body)
      req.headers.set("x-vercel-ip-country",country)
      return req
    }
    assert.equal((await gate.GET(blocked("/api/eligibility"))).status,451)
    assert.equal((await gate.POST(blocked("/api/eligibility",{confirmedAdult:true,country:"JP"}))).status,451)
    assert.equal((await assurance.POST(blocked("/api/eligibility/assurance",{}))).status,451)
    assert.equal((await ticket.GET(blocked("/api/realtime/ticket"))).status,451)
  }
  configure(); delete process.env.SKIP_LAUNCH_READINESS
  delete process.env.VERCEL
  // A standalone request cannot turn its own forwarded country into trust.
  assert.equal((await proxy(new NextRequest(request("/?country=JP")))).status,451)
  process.env.VERCEL="1"
  for (const country of [null,"XX","MX"]) {
    const req = new NextRequest(request("/"))
    if (country) req.headers.set("x-vercel-ip-country",country)
    else req.headers.delete("x-vercel-ip-country")
    assert.equal((await proxy(req)).status,451)
  }
  for (const path of ["/terms","/privacy","/community-guidelines","/safety","/appeals","/reports/recent","/api/auth/signout","/api/auth/csrf"]) {
    const req = new NextRequest(`${origin}${path}`,{headers:{"x-vercel-ip-country":"US"}})
    assert.equal((await proxy(req)).status,200,"legal/safety access remains available")
  }
})

test("every recognized eligible country requires current approval through homepage, OAuth, eligibility and ticket issuance", async () => {
  try {
    for (const country of COUNTRIES_ELIGIBLE_FOR_REVIEW) {
      configure()
      const region = country === "US" ? "NY" : null
      const jurisdiction = region ? `${country}-${region}` : country
      process.env.SUPPORTED_COUNTRIES = country
      process.env.SUPPORTED_SUBDIVISIONS_JSON = region ? JSON.stringify({ [country]: [region] }) : "{}"
      const located = (path: string, body?: unknown) => {
        const req = request(path, body)
        req.headers.set("x-vercel-ip-country", country)
        req.headers.set("x-country", "JP")
        if (region) req.headers.set("x-vercel-ip-country-region", region)
        else req.headers.delete("x-vercel-ip-country-region")
        return req
      }
      for (const entry of [{ ...review, status: "pending_review" }, { ...review, status: undefined }]) {
        process.env.AGE_POLICIES_JSON = JSON.stringify({ [jurisdiction]: entry })
        assert.equal((await proxy(new NextRequest(located("/")))).status, 451, country)
        assert.equal((await proxy(new NextRequest(located("/api/auth/signin/google")))).status, 451, country)
        assert.equal((await gate.POST(located("/api/eligibility", { confirmedAdult: true, country: "JP", status: "approved" }))).status, 451)
        assert.equal((await ticket.GET(located("/api/realtime/ticket"))).status, 451)
      }
      process.env.AGE_POLICIES_JSON = JSON.stringify({ [jurisdiction]: review })
      const declaration = await gate.POST(located("/api/eligibility", { confirmedAdult: true }))
      assert.equal(declaration.status, 200, country)
      const home = await proxy(new NextRequest(located("/")))
      assert.equal(home.status, 200, country)
      assert.equal(home.headers.get("x-middleware-next"), "1", "approved homepage proceeds without the unavailable screen")
      applyCookies(declaration)
      const oauth = new NextRequest(located("/api/auth/callback/google"))
      oauth.cookies.set(AGE_ELIGIBILITY_COOKIE, jar.get(AGE_ELIGIBILITY_COOKIE)!)
      assert.equal((await proxy(oauth)).status, 200, country)
      const issued = await ticket.GET(located("/api/realtime/ticket"))
      assert.equal(issued.status, 200, country)
      const proof = verifyTicket((await issued.json()).ticket)!
      assert.equal(proof.countryCode, country)
      if (region) {
        const otherState = located("/api/realtime/ticket")
        otherState.headers.set("x-vercel-ip-country-region", "TX")
        assert.equal((await ticket.GET(otherState)).status, 451)
      }
      process.env.AGE_POLICIES_JSON = JSON.stringify({ [jurisdiction]: { ...review, reviewBy: "2000-01-01" } })
      assert.equal((await proxy(oauth)).status, 451, "a valid age cookie cannot override an expired review")
      assert.equal((await ticket.GET(located("/api/realtime/ticket"))).status, 451)
    }
  } finally { configure() }
})

test("forged platform headers require an explicitly configured trusted ingress", async () => {
  configure()
  try {
    for (const source of [undefined, "client", "forwarded", "VERCEL"]) {
      if (source === undefined) delete process.env.LAUNCH_GEO_SOURCE
      else process.env.LAUNCH_GEO_SOURCE = source
      const forged = new NextRequest(request("/?country=JP"))
      forged.headers.set("x-forwarded-country", "JP")
      forged.headers.set("cf-ipcountry", "JP")
      assert.equal((await proxy(forged)).status, 451)
      assert.equal((await ticket.GET(forged)).status, 451)
    }
  } finally { configure() }
})
