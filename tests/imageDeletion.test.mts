import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { PGlite } from "@electric-sql/pglite"
import { MIGRATIONS } from "../lib/migrations.ts"
import { storedImageKey, deleteStoredImage } from "../lib/imageStorage.ts"

const pg = new PGlite()
await pg.exec("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL)")
for (const m of MIGRATIONS) {
  await pg.exec(`BEGIN; ${m.sql} COMMIT;`)
  await pg.query("INSERT INTO schema_migrations VALUES($1,0)", [m.id])
}
let transaction = false, failSql = "", loseCommitResponse = false, failStorage = false
const events: string[] = [], deleted: string[] = []
async function query(sql: string, params?: unknown[]) {
  if (failSql && sql.includes(failSql)) { failSql = ""; throw new Error("injected DB failure") }
  if (sql === "BEGIN") transaction = true
  const result = await pg.query(sql, params)
  if (sql === "COMMIT" || sql === "ROLLBACK") {
    transaction = false; events.push(sql)
    if (sql === "COMMIT" && loseCommitResponse) { loseCommitResponse = false; throw new Error("lost commit response") }
  }
  return { rows: result.rows, rowCount: /^SELECT/i.test(sql.trim()) ? result.rows.length : result.affectedRows ?? result.rows.length }
}
process.env.DATABASE_URL = "postgres://localhost/deletion-test"
Object.assign(process.env, { IMAGE_STORAGE_URL: "https://storage.invalid", IMAGE_STORAGE_KEY: "test-only", IMAGE_STORAGE_BUCKET: "images" })
const require = createRequire(import.meta.url)
require("pg").Pool = class {
  on() { return this }
  query = query
  async connect() { return { query, release() {} } }
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  assert.equal(transaction, false, "Storage deletion must never run inside an uncommitted DB transaction")
  assert.equal(String(input), "https://storage.invalid/storage/v1/object/images")
  assert.equal(init?.method, "DELETE")
  assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json")
  const { prefixes } = JSON.parse(String(init?.body))
  for (const key of prefixes) {
    const reference = `/api/media/${key}`
    const refs = await pg.query("SELECT id FROM users WHERE profile_photo=$1 UNION ALL SELECT id FROM user_posts WHERE data_url=$1", [reference])
    assert.equal(refs.rows.length, 0, "Storage object must no longer be referenced")
    events.push("DELETE"); deleted.push(key)
  }
  return new Response(null, { status: failStorage ? 503 : 200 })
}
const db = await import("../lib/db.ts")
after(async () => { globalThis.fetch = originalFetch; await pg.close() })
const reference = (n: number) => `/api/media/aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,"0")}.webp`
async function seed(id: string, photo: string | null = null) {
  await pg.query("INSERT INTO users(id,created_at,profile_photo) VALUES($1,0,$2)", [id,photo])
  events.length = deleted.length = 0
}
async function photo(id: string) {
  return (await pg.query<{profile_photo:string|null}>("SELECT profile_photo FROM users WHERE id=$1",[id])).rows[0].profile_photo
}

test("storedImageKey accepts only generated references; legacy and hostile paths never issue DELETE", async () => {
  assert.equal(storedImageKey(reference(1)),reference(1).slice(11))
  for (const value of [null,undefined,"data:image/png;base64,abc","https://evil.invalid"+reference(1),reference(1)+"?x",reference(1)+"\n",reference(1)+"/child","/api/media/../other","/api/media/%2e%2e"]) {
    assert.equal(storedImageKey(value),null); await deleteStoredImage(value)
  }
  assert.equal(deleted.length,0)
})
test("photo replacement and removal delete only previous objects after commit", async () => {
  await seed("photos",reference(1))
  await db.updateOwnProfile("photos",{profilePhoto:reference(2),bio:"updated"})
  assert.equal(await photo("photos"),reference(2)); assert.deepEqual(deleted,[storedImageKey(reference(1))])
  assert.ok(events.indexOf("COMMIT") < events.indexOf("DELETE"))
  await db.updateOwnProfile("photos",{profilePhoto:reference(2)})
  assert.equal(deleted.length,1,"same photo is retained")
  await db.updateOwnProfile("photos",{profilePhoto:null})
  assert.equal(await photo("photos"),null); assert.equal(deleted.at(-1),storedImageKey(reference(2)))
})
test("legacy profile replacement/removal does not attempt object deletion",async()=>{
  await seed("legacy-photo","data:image/png;base64,old")
  await db.updateOwnProfile("legacy-photo",{profilePhoto:null})
  await db.updateOwnProfile("legacy-photo",{profilePhoto:"data:image/png;base64,other"})
  await db.updateOwnProfile("legacy-photo",{profilePhoto:reference(3)})
  assert.equal(deleted.length,0)
})
test("post deletion enforces ownership, ignores legacy and deletes only returned objects",async()=>{
  await seed("post-owner")
  const post=await db.addPost("post-owner",reference(4))
  assert.equal(await db.removePost("other-user",post.id),false); assert.equal(deleted.length,0)
  assert.equal(await db.removePost("post-owner",post.id),true); assert.deepEqual(deleted,[storedImageKey(reference(4))])
  assert.equal(await db.removePost("post-owner",post.id),false)
  const legacy=await db.addPost("post-owner","data:image/png;base64,old")
  await db.removePost("post-owner",legacy.id); assert.equal(deleted.length,1)
})
test("21st post trims old objects only after insert and trim commit",async()=>{
  await seed("trim")
  for(let i=0;i<20;i++) await pg.query("INSERT INTO user_posts VALUES($1,$2,$3,$4)",["trim-"+i,"trim",i===0?reference(5):"data:image/png;base64,old",i])
  await db.addPost("trim",reference(6))
  assert.deepEqual(deleted,[storedImageKey(reference(5))])
  assert.equal((await db.listPosts("trim")).length,20)
  assert.ok(events.indexOf("COMMIT") < events.indexOf("DELETE"))
})
test("photo DB failure rolls back old photo and deletes the unreferenced new upload",async()=>{
  await seed("photo-fail",reference(7))
  failSql="UPDATE users SET bio="
  await assert.rejects(db.updateOwnProfile("photo-fail",{profilePhoto:reference(8),bio:"fail"}))
  assert.equal(await photo("photo-fail"),reference(7)); assert.deepEqual(deleted,[storedImageKey(reference(8))])
  assert.ok(events.indexOf("ROLLBACK") < events.indexOf("DELETE"))
})
test("trim failure rolls back insert and retains old posts; new upload is cleaned",async()=>{
  await seed("post-fail")
  await pg.query("INSERT INTO user_posts VALUES('existing','post-fail',$1,0)",[reference(9)])
  failSql="DELETE FROM user_posts WHERE user_id="
  await assert.rejects(db.addPost("post-fail",reference(10)))
  assert.deepEqual((await db.listPosts("post-fail")).map(p=>p.dataUrl),[reference(9)])
  assert.deepEqual(deleted,[storedImageKey(reference(10))])
})
test("failed post deletion does not delete its object",async()=>{
  await seed("delete-fail")
  const post=await db.addPost("delete-fail",reference(11))
  failSql="DELETE FROM user_posts WHERE id="
  await assert.rejects(db.removePost("delete-fail",post.id)); assert.equal(deleted.length,0)
})
test("account erasure deletes profile and posts after audit/erasure commit, ignoring legacy",async()=>{
  await seed("erase",reference(12))
  await db.addPost("erase",reference(13)); await db.addPost("erase","data:image/png;base64,old")
  events.length=0
  await db.eraseUserData("erase","admin","case-123")
  assert.deepEqual(new Set(deleted),new Set([storedImageKey(reference(12)),storedImageKey(reference(13))]))
  assert.ok(events.indexOf("COMMIT") < events.indexOf("DELETE"))
  assert.equal((await db.listPosts("erase")).length,0)
  assert.equal((await pg.query("SELECT id FROM privacy_operations WHERE user_id='erase' AND action='erase'")).rows.length,1)
})
test("failed account erasure retains all objects and DB references",async()=>{
  await seed("erase-fail",reference(14)); await db.addPost("erase-fail",reference(15))
  failSql="INSERT INTO privacy_operations"
  await assert.rejects(db.eraseUserData("erase-fail","admin","case-456"))
  assert.equal(await photo("erase-fail"),reference(14)); assert.equal((await db.listPosts("erase-fail")).length,1)
  assert.equal(deleted.length,0)
})
test("lost commit response never deletes an upload already committed",async()=>{
  await seed("ambiguous",reference(16)); loseCommitResponse=true
  await assert.rejects(db.updateOwnProfile("ambiguous",{profilePhoto:reference(17)}))
  assert.equal(await photo("ambiguous"),reference(17)); assert.equal(deleted.length,0)
})
test("shared references and storage outages do not break successful DB mutations",async()=>{
  await seed("shared-a",reference(18)); await seed("shared-b",reference(18))
  await db.updateOwnProfile("shared-a",{profilePhoto:null}); assert.equal(deleted.length,0)
  failStorage=true
  try { await db.updateOwnProfile("shared-b",{profilePhoto:null}) } finally { failStorage=false }
  assert.equal(await photo("shared-b"),null); assert.deepEqual(deleted,[storedImageKey(reference(18))])
})

test("failed post commit restores trimmed rows before cleaning only the new upload",async()=>{
  await seed("commit-fail")
  for(let i=0;i<20;i++) await pg.query("INSERT INTO user_posts VALUES($1,$2,$3,$4)",["commit-"+i,"commit-fail",i===0?reference(19):"data:image/png;base64,old",i])
  failSql="COMMIT"
  await assert.rejects(db.addPost("commit-fail",reference(20)))
  assert.equal((await db.listPosts("commit-fail")).length,20)
  assert.ok((await db.listPosts("commit-fail")).some(post=>post.dataUrl===reference(19)))
  assert.deepEqual(deleted,[storedImageKey(reference(20))])
  assert.ok(events.indexOf("ROLLBACK") < events.indexOf("DELETE"))
})
