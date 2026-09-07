import { test, mock } from "node:test"
import assert from "node:assert/strict"

let userId: string | null = "tester"
let banned = false
let failGrant = false
const grants: string[] = []
mock.module("../auth.ts", { namedExports: { auth: async () => userId ? { user: { id: userId } } : null } })
mock.module("../lib/db.ts", { namedExports: {
  getUserStatus: async () => ({ banned, deleted: false, suspendedUntil: null }),
  grantFreeRizzPlus: async (id: string) => { if (failGrant) throw new Error("test_db_unavailable"); grants.push(id) },
} })
mock.module("../lib/apiRateLimit.ts", { namedExports: { isRateLimited: () => false } })
const { POST } = await import("../app/api/billing/checkout/route.ts")
const request = (origin = "https://rizzuno.com") => new Request("https://rizzuno.com/api/billing/checkout", { method: "POST", headers: { origin } })

test("free Rizz+ activation grants the signed-in account without a Stripe redirect", async () => {
  const response = await POST(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { active: true, testMode: true })
  assert.deepEqual(grants, ["tester"])
  assert.equal(response.headers.get("cache-control"), "no-store")
})

test("free activation rejects unsigned, cross-origin, and banned requests", async () => {
  const before = grants.length
  userId = null
  assert.equal((await POST(request())).status, 401)
  userId = "tester"
  assert.equal((await POST(request("https://other.example"))).status, 403)
  banned = true
  assert.equal((await POST(request())).status, 403)
  banned = false
  assert.equal(grants.length, before)
})

test("free activation never reports success if saving the grant fails", async () => {
  failGrant = true
  assert.equal((await POST(request())).status, 503)
  failGrant = false
})

test("free activation works on the served origin without billing configuration", async () => {
  const oldOrigin = process.env.APP_URL
  delete process.env.APP_URL
  try {
    const response = await POST(new Request("https://preview.example/api/billing/checkout", {
      method: "POST", headers: { origin: "https://preview.example" },
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { active: true, testMode: true })
    const missingOrigin = await POST(new Request("https://preview.example/api/billing/checkout", { method: "POST" }))
    assert.equal(missingOrigin.status, 403)
  } finally {
    if (oldOrigin === undefined) delete process.env.APP_URL
    else process.env.APP_URL = oldOrigin
  }
})
