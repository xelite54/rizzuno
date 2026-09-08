import { test, mock } from "node:test"
import assert from "node:assert/strict"

// Route-level tests for GET /api/friends/messages/[friendshipId] — the
// real Next.js Route Handler (unmodified), driven directly the same way
// tests/publicProfile.test.mts already drives its own route. Separate
// process from the ws-server suite (each test FILE gets its own — see
// dbMock.mts's own doc comment on why registering `mock.module()` once per
// file, not once per test, is safe), so this registers its own minimal
// `lib/db.ts`/`auth.ts` mocks rather than reusing tests/helpers/dbMock.mts.

let signedIn = true
let currentUserId = "alice"
type Row = { id: string; senderId: string; text: string; createdAt: number }
const store: Record<string, Row[]> = {}
const ownership: Record<string, [string, string]> = {}

mock.module("../auth.ts", { exports: { auth: async () => (signedIn ? { user: { id: currentUserId } } : null) } })
mock.module("../lib/db.ts", {
  exports: {
    listFriendMessages: async (userId: string, friendshipId: string, limit = 50) => {
      const pair = ownership[friendshipId]
      if (!pair || (pair[0] !== userId && pair[1] !== userId)) return { status: "not_found" }
      return { status: "ok", messages: (store[friendshipId] ?? []).slice(-limit) }
    },
    describeDbError: (err: unknown) => ({ message: err instanceof Error ? err.message : String(err) }),
  },
})
mock.module("../lib/apiRateLimit.ts", { exports: { isRateLimited: () => false } })

const { GET } = await import("../app/api/friends/messages/[friendshipId]/route.ts")
const get = (friendshipId: string) =>
  GET(new Request(`https://rizzuno.com/api/friends/messages/${friendshipId}`), { params: Promise.resolve({ friendshipId }) })

// Test 4/5 — real persisted history comes back, and a plain re-fetch
// ("refresh") returns the same thing — there is no client-local state
// here at all for a refresh to lose; this is exactly what "refresh
// preserves history" means at the API layer.
test("Test 4/5 — history contains a persisted message, and a repeated fetch ('refresh') returns the same history", async () => {
  currentUserId = "alice"
  ownership["friendship-1"] = ["alice", "bob"]
  store["friendship-1"] = [{ id: "m1", senderId: "bob", text: "hi alice", createdAt: 1000 }]

  const first = await get("friendship-1")
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  assert.equal(firstBody.messages.length, 1)
  assert.equal(firstBody.messages[0].text, "hi alice")
  assert.equal(firstBody.messages[0].mine, false, "sent by bob, not the caller (alice)")

  const second = await get("friendship-1")
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), firstBody)
})

test("`mine` reflects the caller, not a fixed side — the same history read as the sender", async () => {
  currentUserId = "bob"
  ownership["friendship-1"] = ["alice", "bob"]
  store["friendship-1"] = [{ id: "m1", senderId: "bob", text: "hi alice", createdAt: 1000 }]
  const response = await get("friendship-1")
  const body = await response.json()
  assert.equal(body.messages[0].mine, true)
})

// Test 7 — a friendshipId that isn't the caller's own is never a way to
// read someone else's messages. Same response (404) whether the
// friendship never existed or simply isn't the caller's — never confirms
// which, to whoever's asking.
test("Test 7 — a friendshipId that does not belong to the caller cannot be used to access messages", async () => {
  currentUserId = "mallory"
  ownership["friendship-1"] = ["alice", "bob"]
  store["friendship-1"] = [{ id: "m1", senderId: "bob", text: "private conversation", createdAt: 1000 }]

  const response = await get("friendship-1")
  assert.equal(response.status, 404)
  const body = await response.json()
  assert.equal(body.error, "not_found")
})

test("a friendshipId that never existed at all gets the identical 404", async () => {
  currentUserId = "alice"
  const response = await get("no-such-friendship")
  assert.equal(response.status, 404)
})

test("requires authentication", async () => {
  signedIn = false
  const response = await get("friendship-1")
  assert.equal(response.status, 401)
  signedIn = true
})
