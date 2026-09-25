import { test } from "node:test"
import assert from "node:assert/strict"
import { fetchPublicProfile, resolveProfilePhoto } from "../lib/publicProfile.ts"

const photo = "/api/media/0b7c3f5e-1d2a-4c6b-9e8f-123456789abc.webp"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

test("fresh server photo wins over a stale snapshot", () => {
  assert.equal(resolveProfilePhoto({ profilePhoto: photo }, "data:image/png;base64,old"), photo)
  assert.equal(resolveProfilePhoto({ profilePhoto: photo }, null), photo)
})

test("a photo removed on the server is not resurrected from the snapshot", () => {
  assert.equal(resolveProfilePhoto({ profilePhoto: null }, "data:image/png;base64,old"), null)
})

test("snapshot is only a placeholder until the server profile loads", () => {
  assert.equal(resolveProfilePhoto(null, "data:image/png;base64,old"), "data:image/png;base64,old")
  assert.equal(resolveProfilePhoto(null, ""), null)
  assert.equal(resolveProfilePhoto(undefined), null)
})

test("fetchPublicProfile returns another user's custom photo and shares one request", async () => {
  let calls = 0
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls++
    assert.equal(url, "/api/profile/public/alex")
    assert.equal(init?.cache, "no-store")
    return json({ username: "alex", profilePhoto: photo, bio: "Hi", posts: [{ id: "p", dataUrl: photo }] })
  }) as typeof fetch
  const [a, b] = await Promise.all([fetchPublicProfile("alex", fetcher), fetchPublicProfile("alex", fetcher)])
  assert.equal(calls, 1)
  assert.equal(a.profilePhoto, photo)
  assert.equal(b.posts.length, 1)
  await fetchPublicProfile("alex", fetcher)
  assert.equal(calls, 2, "a finished request is not cached — reopening refetches")
})

test("fetchPublicProfile falls back to no photo and surfaces 404s", async () => {
  const empty = await fetchPublicProfile("sam", (async () => json({ username: "sam", profilePhoto: "", bio: "", posts: [] })) as typeof fetch)
  assert.equal(empty.profilePhoto, null)
  await assert.rejects(fetchPublicProfile("gone", (async () => json({ error: "not_found" }, 404)) as typeof fetch), /Profile unavailable/)
})
