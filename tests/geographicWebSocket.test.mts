import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { startTestServer, TestClient, connectAndHello } from "./helpers/wsHarness.mts"
import { configureTestAccess, mintTicket as mintTestTicket, testAgeReview } from "./helpers/accessPolicy.mts"
import { EXCLUDED_COUNTRIES } from "../lib/geographicAccess.ts"
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
