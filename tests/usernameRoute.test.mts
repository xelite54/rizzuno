import { test, mock } from "node:test"
import assert from "node:assert/strict"

process.env.DATABASE_URL ||= "postgres://test-unused"
let userId: string | null = "account-a"
const writes: string[] = []
mock.module("../auth.ts", { namedExports: { auth: async () => userId ? { user: { id: userId } } : null } })
mock.module("../lib/db.ts", { namedExports: {
  claimUsername: async (_id: string, username: string) => { writes.push(username); return { ok: true } },
  getUsername: async () => "old_name",
  getUserStatus: async () => ({ banned: false, deleted: false }),
  describeDbError: () => ({}),
} })
mock.module("../lib/apiRateLimit.ts", { namedExports: { isRateLimited: () => false } })
const { POST } = await import("../app/api/profile/username/route.ts")
const request = (username: unknown) => new Request("https://rizzuno.com/api/profile/username", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }),
})

test("the shared signup/rename endpoint rejects bypass attempts before writing to the database", async () => {
  for (const username of ["FuCk", "s_h_i_t", "N.1.G.G.3.R", "xxbitch99", "fuuuck"]) {
    const response = await POST(request(username))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: "username_blocked" })
  }
  assert.deepEqual(writes, [])
})

test("safe username picks and subsequent changes still save", async () => {
  for (const username of ["Alice_2026", "Blue.Sky"]) {
    assert.equal((await POST(request(username))).status, 200)
  }
  assert.deepEqual(writes, ["alice_2026", "blue.sky"])
})

test("unauthenticated clients cannot claim usernames", async () => {
  userId = null
  assert.equal((await POST(request("safe_name"))).status, 401)
})
