import { test } from "node:test"
import assert from "node:assert/strict"
import { regionUnavailableResponse } from "../lib/geographicResponse.ts"
import { proxy } from "../proxy.ts"
import { NextRequest } from "next/server"

test("denials explain pending, expired, excluded, unknown and inactive locations without exposing review records", async () => {
  const before = { ...process.env }
  const review = { status: "approved", minimumAge: 18, mode: "self_attestation", reference: "private-review-case-do-not-disclose", reviewBy: "2099-01-01" }
  try {
    Object.assign(process.env, { VERCEL: "1", LAUNCH_GEO_SOURCE: "vercel", SUPPORTED_COUNTRIES: "JP", SUPPORTED_US_REGIONS: "", SUPPORTED_SUBDIVISIONS_JSON: "{}" })
    const scenarios = [
      { country: "JP", entries: {}, reason: "review_missing", detail: /pending.*review/ },
      { country: "JP", entries: { JP: { ...review, status: "pending_review" } }, reason: "review_pending", detail: /pending.*review/ },
      { country: "JP", entries: { JP: { ...review, reviewBy: "2000-01-01" } }, reason: "review_expired", detail: /renewed/ },
      { country: "JP", entries: { JP: { ...review, minimumAge: 17 } }, reason: "review_invalid", detail: /review is complete/ },
      { country: "JP", entries: { JP: { ...review, status: "blocked" } }, reason: "policy_blocked", detail: /current policy/ },
      { country: "CA", entries: { CA: review }, reason: "activation_pending", detail: /not been activated/ },
      { country: "US", entries: {}, reason: "subdivision_required", detail: /state or subdivision/ },
      { country: "AU", entries: { AU: review }, reason: "country_excluded", detail: /does not offer service/ },
      { country: "XX", entries: {}, reason: "location_unknown", detail: /could not verify your country/ },
    ]
    for (const scenario of scenarios) {
      process.env.AGE_POLICIES_JSON = JSON.stringify(scenario.entries)
      const headers = { "x-vercel-ip-country": scenario.country }
      const response = await regionUnavailableResponse(new Request("https://rizzuno.test/api/eligibility", { headers }))
      assert.equal(response.status, 451)
      assert.match(response.headers.get("cache-control")!, /private, no-store/)
      const body = await response.json()
      assert.equal(body.reason, scenario.reason)
      assert.match(body.detail, scenario.detail)
      assert.doesNotMatch(JSON.stringify(body), /private-review-case/)
      const page = await proxy(new NextRequest("https://rizzuno.test/", { headers }))
      const html = await page.text()
      assert.match(html, scenario.detail)
      assert.doesNotMatch(html, /private-review-case/)
    }
    process.env.AGE_POLICIES_JSON = "invalid"
    const malformed = await regionUnavailableResponse(new Request("https://rizzuno.test/api/eligibility", { headers: { "x-vercel-ip-country": "JP" } }))
    assert.equal((await malformed.json()).reason, "configuration_invalid")
  } finally { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) }
})
