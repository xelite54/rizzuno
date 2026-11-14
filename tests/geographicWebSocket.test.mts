import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { startTestServer, TestClient, connectAndHello } from "./helpers/wsHarness.mts"
import { configureTestAccess, mintTicket as mintTestTicket, testAgeReview } from "./helpers/accessPolicy.mts"
import { COUNTRIES_ELIGIBLE_FOR_REVIEW, EXCLUDED_COUNTRIES } from "../lib/geographicAccess.ts"
import { mintTicket, verifyTicket } from "../lib/realtimeTicket.ts"
import { agePolicyForLocation } from "../lib/agePolicy.ts"

test("direct WebSocket hellos cannot use excluded, missing, tampered or legacy location claims", async () => {
  configureTestAccess()
  const server = await startTestServer()
  try {
    const permitted = await connectAndHello(server.url,"approved-client")
    permitted.close()
    const policy = agePolicyForLocation("JP",null)!
    const details = {ageExpiresAt:Date.now()+60000,agePolicyKey:policy.key,subdivision:null}
    for (const country of [...EXCLUDED_COUNTRIES,undefined]) {
      const client = new TestClient(server.url)
      await client.waitForOpen()
      // Genuinely signed but geographically ineligible ticket: the signer
      // cannot override the mandatory exclusion/allowlist on the consumer.
      client.ws.send(JSON.stringify({type:"hello",ticket:mintTicket("excluded-client",country,details),handle:"example",countryCode:"JP",subdivision:"13",eligible:true}))
      assert.equal((await client.waitForType("rejected")).reason,"invalid_ticket",country)
      client.close()
    }
    const valid = mintTestTicket("tamper-client")
    const [payload,mac] = valid.split(".")
    const forged = Buffer.from(Buffer.from(payload,"base64url").toString().replace('"JP"','"MX"')).toString("base64url")
    assert.equal(verifyTicket(`${forged}.${mac}`),null)
    // An otherwise authentic ticket from the old wire format is invalidated.
    const oldPayload = Buffer.from(JSON.stringify({sub:"legacy",exp:Date.now()+60000,countryCode:"JP",...details})).toString("base64url")
    const key = createHmac("sha256",process.env.REALTIME_TICKET_SECRET!).update("rizzuno:realtime-ticket:v1").digest()
    const oldTicket = `${oldPayload}.${createHmac("sha256",key).update(oldPayload).digest("base64url")}`
    assert.equal(verifyTicket(oldTicket),null)
    process.env.SUPPORTED_SUBDIVISIONS_JSON = JSON.stringify({JP:["13"]})
    process.env.AGE_POLICIES_JSON = JSON.stringify({JP:testAgeReview,"JP-13":testAgeReview})
    assert.equal(verifyTicket(valid),null,"country-only ticket cannot bypass a new subdivision restriction")
    const regionPolicy=agePolicyForLocation("JP","13")!
    const scoped=mintTicket("scoped","JP",{...details,agePolicyKey:regionPolicy.key,subdivision:"13"})
    assert.equal(verifyTicket(scoped)?.subdivision,"13")
    process.env.SUPPORTED_COUNTRIES=""
    assert.equal(verifyTicket(scoped),null,"removing approval revokes a previously valid ticket")
    configureTestAccess()
    const live = await connectAndHello(server.url,"revoked-live-client")
    process.env.SUPPORTED_COUNTRIES=""
    live.send({type:"find"})
    assert.equal((await live.waitForType("rejected")).reason,"region_unavailable","live revocation does not ask for another age declaration")
    live.close()
  } finally { configureTestAccess(); await server.close() }
})

test("pending country decisions cannot be bypassed with authentic old tickets or forged WebSocket headers", async () => {
  const server = await startTestServer()
  try {
    for (const country of COUNTRIES_ELIGIBLE_FOR_REVIEW) {
      configureTestAccess()
      process.env.SUPPORTED_COUNTRIES = country
      process.env.SUPPORTED_SUBDIVISIONS_JSON = country === "US" ? '{"US":["NY"]}' : "{}"
      const subdivision = country === "US" ? "NY" : null
      const jurisdiction = subdivision ? `${country}-${subdivision}` : country
      process.env.AGE_POLICIES_JSON = JSON.stringify({ [jurisdiction]: testAgeReview })
      const policy = agePolicyForLocation(country, subdivision)!
      const ticket = mintTicket(`pending-${country}`, country, { ageExpiresAt: Date.now() + 60000, agePolicyKey: policy.key, subdivision })
      assert.ok(verifyTicket(ticket), country)
      process.env.AGE_POLICIES_JSON = JSON.stringify({ [jurisdiction]: { ...testAgeReview, status: "pending_review" } })
      const client = new TestClient(server.url, { headers: { "x-vercel-ip-country": "JP", "x-vercel-ip-country-region": "13", "x-forwarded-for": "127.0.0.1" } })
      await client.waitForOpen()
      client.ws.send(JSON.stringify({ type: "hello", ticket, handle: "example", countryCode: "JP", eligible: true }))
      assert.equal((await client.waitForType("rejected")).reason, "invalid_ticket", country)
      client.close()
    }
  } finally { configureTestAccess(); await server.close() }
})

test("each recognized eligible country can admit and match two adults under its own synthetic approval", async () => {
  const server = await startTestServer()
  try {
    for (const country of COUNTRIES_ELIGIBLE_FOR_REVIEW) {
      configureTestAccess()
      const subdivision = country === "US" ? "NY" : null
      process.env.SUPPORTED_COUNTRIES = country
      process.env.SUPPORTED_SUBDIVISIONS_JSON = subdivision ? '{"US":["NY"]}' : "{}"
      process.env.AGE_POLICIES_JSON = JSON.stringify({ [subdivision ? `${country}-${subdivision}` : country]: testAgeReview })
      const policy = agePolicyForLocation(country, subdivision)!
      const clients: TestClient[] = []
      try {
        for (const [index, gender] of ["male", "female"].entries()) {
          const client = new TestClient(server.url); clients.push(client); await client.waitForOpen()
          client.send({ type: "hello", ticket: mintTicket(`approved-${country}-${index}`, country, { ageExpiresAt: Date.now() + 60000, agePolicyKey: policy.key, subdivision }), handle: "example", gender: gender as "male" | "female", profilePhoto: null })
          await client.waitForType("ready")
        }
        clients.forEach(client => client.send({ type: "find" }))
        const [a, b] = await Promise.all(clients.map(client => client.waitForType("matched")))
        assert.equal(a.roomId, b.roomId, country)
        assert.equal(a.peer.countryCode, country)
      } finally {
        await Promise.all(clients.map(client => new Promise<void>(resolve => {
          if (client.ws.readyState === 3) return resolve()
          client.ws.once("close", () => resolve()); client.close()
        })))
      }
    }
  } finally { configureTestAccess(); await server.close() }
})

test("current U.S. state approval permits matching and a live approval withdrawal revokes it", async () => {
  configureTestAccess()
  process.env.SUPPORTED_COUNTRIES = "US"
  process.env.SUPPORTED_US_REGIONS = "NY"
  process.env.AGE_POLICIES_JSON = JSON.stringify({ "US-NY": testAgeReview })
  const server = await startTestServer()
  const clients: TestClient[] = []
  try {
    const policy = agePolicyForLocation("US", "NY")!
    for (const [index, gender] of ["male", "female"].entries()) {
      const client = new TestClient(server.url); clients.push(client); await client.waitForOpen()
      client.ws.send(JSON.stringify({ type: "hello", ticket: mintTicket(`ny-${index}`, "US", { ageExpiresAt: Date.now() + 60000, agePolicyKey: policy.key, subdivision: "NY" }), handle: "example", gender, profilePhoto: null }))
      await client.waitForType("ready")
    }
    clients.forEach(client => client.send({ type: "find" }))
    const [a, b] = await Promise.all(clients.map(client => client.waitForType("matched")))
    assert.equal(a.roomId, b.roomId)
    const badState = mintTicket("unapproved-state", "US", { ageExpiresAt: Date.now() + 60000, agePolicyKey: policy.key, subdivision: "TX" })
    assert.equal(verifyTicket(badState), null)
    process.env.AGE_POLICIES_JSON = JSON.stringify({ "US-NY": { ...testAgeReview, status: "pending_review" } })
    clients[0].send({ type: "rtc-ready", roomId: a.roomId })
    assert.equal((await clients[0].waitForType("rejected")).reason, "region_unavailable")
  } finally { clients.forEach(client => client.close()); configureTestAccess(); await server.close() }
})
