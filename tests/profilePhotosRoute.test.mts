import { test, mock } from "node:test"
import assert from "node:assert/strict"

let signedIn = true
let viewerBanned = false
let asked: string[] = []
mock.module("../auth.ts", { exports: { auth: async () => signedIn ? { user: { id: "viewer" } } : null } })
mock.module("../lib/db.ts", { exports: {
  getUserStatus: async () => ({ banned: viewerBanned, deleted: false, suspendedUntil: null }),
  getCurrentProfilePhotos: async (_viewer: string, usernames: string[]) => {
    asked = usernames
    return Object.fromEntries(usernames.filter((u) => u !== "hidden").map((u) => [u, u === "alpha" ? "/api/media/a.webp" : null]))
  },
} })
mock.module("../lib/apiRateLimit.ts", { exports: { isRateLimited: () => false } })
const { GET } = await import("../app/api/profile/photos/route.ts")
const get = (query: string) => GET(new Request(`https://rizzuno.com/api/profile/photos?${query}`))

test("returns each user's current photo, null for none, and omits hidden accounts", async () => {
  const response = await get("u=Alpha&u=bravo&u=hidden&u=alpha&u=../bad")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(asked, ["alpha", "bravo", "hidden"], "normalized, deduped, invalid dropped")
  assert.deepEqual((await response.json()).photos, { alpha: "/api/media/a.webp", bravo: null })
})

test("requires sign-in, bounds the batch, and reveals nothing to restricted viewers", async () => {
  signedIn = false
  assert.equal((await get("u=alpha")).status, 401)
  signedIn = true
  const { normalizeUsername } = await import("../lib/username.ts")
  const names = Array.from({ length: 80 }, (_, i) => `user${String(i).padStart(3, "0")}`).filter((u) => normalizeUsername(u)).slice(0, 51)
  assert.equal(names.length, 51)
  const many = names.map((u) => `u=${u}`).join("&")
  assert.equal((await get(many)).status, 400)
  viewerBanned = true
  assert.deepEqual((await (await get("u=alpha")).json()).photos, {})
  viewerBanned = false
})
