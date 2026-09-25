import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { PGlite } from "@electric-sql/pglite"
import { MIGRATIONS } from "../lib/migrations.ts"

// Real SQL (PGlite + every migration): user A changes their photo and user B
// must see the CURRENT users.profile_photo at every step of the friend flow.
const pg = new PGlite()
await pg.exec("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL)")
for (const m of MIGRATIONS) {
  await pg.exec(`BEGIN; ${m.sql} COMMIT;`)
  await pg.query("INSERT INTO schema_migrations VALUES($1,0)", [m.id])
}
async function query(sql: string, params?: unknown[]) {
  const result = await pg.query(sql, params)
  return { rows: result.rows, rowCount: /^SELECT/i.test(sql.trim()) ? result.rows.length : result.affectedRows ?? result.rows.length }
}
process.env.DATABASE_URL = "postgres://localhost/photo-lifecycle-test"
const require = createRequire(import.meta.url)
require("pg").Pool = class {
  on() { return this }
  query = query
  async connect() { return { query, release() {} } }
}
const db = await import("../lib/db.ts")

const firstPhoto = "/api/media/11111111-1111-4111-8111-111111111111.webp"
const newPhoto = "/api/media/22222222-2222-4222-8222-222222222222.webp"
const setPhoto = (id: string, photo: string | null) => pg.query("UPDATE users SET profile_photo=$1 WHERE id=$2", [photo, id])

await pg.query("INSERT INTO users(id,created_at,username) VALUES('user-a',0,'alpha'),('user-b',0,'bravo'),('user-c',0,'charlie')")
// Friend requests are a Rizz+ feature.
for (const id of ["user-a", "user-b", "user-c"]) await db.grantFreeRizzPlus(id)

test("A's changed photo reaches B through search, requests, friendship and batch lookup", async () => {
  await setPhoto("user-a", firstPhoto)
  await setPhoto("user-a", newPhoto) // A changes their picture

  const [found] = await db.searchUsersByUsername("alph", "user-b")
  assert.equal(found.profilePhoto, newPhoto, "search result")
  assert.equal((await db.getPublicProfile("user-a")).profilePhoto, newPhoto, "public profile")

  const sent = await db.sendFriendRequest("user-b", "user-a")
  assert.equal(sent.status, "sent")
  const [outgoing] = await db.listPendingRequestsSent("user-b")
  assert.equal(outgoing.username, "alpha", "requested state knows who it is")
  assert.equal(outgoing.profilePhoto, newPhoto, "requested state")
  assert.equal((await db.searchUsersByUsername("alph", "user-b"))[0].alreadyRequested, true)
  const [incoming] = await db.listPendingRequestsReceived("user-a")
  assert.equal(incoming.profilePhoto, null, "B has no photo — A sees the fallback")

  assert.equal((await db.respondToFriendRequest("user-a", incoming.requestId, true)).status, "accepted")
  const [friend] = await db.listFriends("user-b")
  assert.equal(friend.profilePhoto, newPhoto, "friend list / chat header")
  assert.equal((await db.getPublicProfile(friend.userId)).profilePhoto, newPhoto, "full friend profile")

  assert.deepEqual(await db.getCurrentProfilePhotos("user-b", ["alpha", "charlie"]), { alpha: newPhoto, charlie: null })
})

test("a later change or removal is what everyone reads next", async () => {
  await setPhoto("user-a", firstPhoto)
  assert.equal((await db.listFriends("user-b"))[0].profilePhoto, firstPhoto)
  await setPhoto("user-a", null)
  assert.equal((await db.listFriends("user-b"))[0].profilePhoto, null)
  assert.deepEqual(await db.getCurrentProfilePhotos("user-b", ["alpha"]), { alpha: null })
})

test("pending request photos are live-joined, not frozen at request time", async () => {
  await setPhoto("user-c", firstPhoto)
  await db.sendFriendRequest("user-c", "user-b")
  await setPhoto("user-c", newPhoto)
  assert.equal((await db.listPendingRequestsReceived("user-b"))[0].profilePhoto, newPhoto)
  assert.equal((await db.listPendingRequestsSent("user-c"))[0].profilePhoto, null)
})

test("batch lookup hides blocked, banned and suspended accounts", async () => {
  await setPhoto("user-c", newPhoto)
  await db.addBlock("user-c", "user-b")
  assert.deepEqual(await db.getCurrentProfilePhotos("user-b", ["charlie"]), {})
  await pg.query("DELETE FROM blocks")
  await pg.query("UPDATE users SET suspended_until=$1 WHERE id='user-c'", [Date.now() + 60_000])
  assert.deepEqual(await db.getCurrentProfilePhotos("user-b", ["charlie"]), {})
  await pg.query("UPDATE users SET suspended_until=NULL, banned_at=1 WHERE id='user-c'")
  assert.deepEqual(await db.getCurrentProfilePhotos("user-b", ["charlie"]), {})
})
