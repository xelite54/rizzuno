import { test } from "node:test"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

let member = false
let incoming = false
let resolvedRequestExists = false
const writes: string[] = []
async function query(sql: string) {
  if (resolvedRequestExists && sql.includes("INSERT INTO friend_requests") && !sql.includes("ON CONFLICT (sender_id, recipient_id)")) throw new Error("duplicate key violates friend_requests_sender_id_recipient_id_key")
  if (sql.includes("FROM billing_subscriptions")) return { rows: member ? [{}] : [] }
  if (sql.includes("SELECT id FROM friend_requests") && sql.includes("FOR UPDATE")) return { rows: incoming ? [{ id: "request" }] : [] }
  if (sql.includes("SELECT sender_id FROM friend_requests")) return { rows: [{ sender_id: "plus-sender" }] }
  if (sql.includes("INSERT INTO friend_requests") || sql.includes("INSERT INTO friendships")) writes.push(sql)
  return { rows: [], rowCount: 0 }
}
process.env.DATABASE_URL = "postgres://localhost/mock"
const require = createRequire(import.meta.url)
require("pg").Pool = class {
  query = query
  async connect() { return { query, release() {} } }
}
const { sendFriendRequest, respondToFriendRequest } = await import("../lib/db.ts")

test("only Plus senders can create new requests", async () => {
  assert.deepEqual(await sendFriendRequest("free", "target"), { status: "subscription_required" })
  assert.equal(writes.length, 0)
  member = true
  assert.equal((await sendFriendRequest("plus", "target")).status, "sent")
  assert.equal(writes.length, 1)
})

test("a free recipient can accept a request, including mutual Add", async () => {
  member = false
  incoming = true
  assert.equal((await sendFriendRequest("free", "plus-sender")).status, "auto_accepted")
  assert.equal((await respondToFriendRequest("free", "request", true)).status, "accepted")
})

test("a resolved request can be sent again without violating the pair unique constraint", async () => {
  member = true; incoming = false; resolvedRequestExists = true
  const result = await sendFriendRequest("plus", "previous-recipient")
  assert.equal(result.status, "sent")
  assert.match(writes.at(-1)!, /resolved_at=NULL/)
  assert.match(writes.at(-1)!, /id=EXCLUDED.id/)
  resolvedRequestExists = false
})
