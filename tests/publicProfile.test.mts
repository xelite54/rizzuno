import { test, mock } from "node:test"
import assert from "node:assert/strict"
let signedIn = true
let blocked = false
let banned = false
let readCount = 0
mock.module("../auth.ts", { exports: { auth: async () => signedIn ? { user: { id: "viewer" } } : null } })
mock.module("../lib/db.ts", { exports: {
  getUserIdByUsername: async (name: string) => name === "alex" ? "target" : null,
  getUserStatus: async () => ({ banned, deleted: false, suspendedUntil: null }),
  isBlockedEitherWay: async () => blocked,
  getPublicProfile: async () => { readCount++; return { username: "alex", profilePhoto: null, bio: "Hello", posts: [{ id: "post", dataUrl: "data:image/png;base64,test" }] } },
} })
mock.module("../lib/apiRateLimit.ts", { exports: { isRateLimited: () => false } })
const { GET } = await import("../app/api/profile/public/[username]/route.ts")
const get = (username = "alex") => GET(new Request("https://rizzuno.com/api/profile/public/alex"), { params: Promise.resolve({ username }) })
test("non-friends can read public posts without a subscription", async () => {
  const response = await get()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).posts[0].id, "post")
  assert.equal(response.headers.get("cache-control"), "no-store")
})
test("blocked and restricted profiles do not expose posts", async () => {
  const before = readCount
  blocked = true
  assert.equal((await get()).status, 404)
  blocked = false; banned = true
  assert.equal((await get()).status, 404)
  banned = false
  assert.equal(readCount, before)
})
test("public profile endpoint requires authentication and a valid existing username", async () => {
  signedIn = false
  assert.equal((await get()).status, 401)
  signedIn = true
  assert.equal((await get("../invalid")).status, 404)
  assert.equal((await get("missing")).status, 404)
})
