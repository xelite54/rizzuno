import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { PGlite } from "@electric-sql/pglite"
import { MIGRATIONS } from "../lib/migrations.ts"

// Unified reporting model: one `reports` table with target types, server-side
// target resolution, reusable content removal and the separate NCII case.
const pg = new PGlite()
await pg.exec("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL)")
for (const migration of MIGRATIONS) {
  await pg.exec(`BEGIN; ${migration.sql} COMMIT;`)
  await pg.query("INSERT INTO schema_migrations VALUES($1,0)", [migration.id])
}
async function query(sql: string, params?: unknown[]) {
  const result = await pg.query(sql, params)
  return { rows: result.rows, rowCount: /^SELECT/i.test(sql.trim()) ? result.rows.length : result.affectedRows ?? result.rows.length }
}
process.env.DATABASE_URL = "postgres://localhost/unified-reports-test"
Object.assign(process.env, { IMAGE_STORAGE_URL: "https://storage.invalid", IMAGE_STORAGE_KEY: "test-only", IMAGE_STORAGE_BUCKET: "images" })
const require = createRequire(import.meta.url)
require("pg").Pool = class { on() { return this } query = query; async connect() { return { query, release() {} } } }

const storageDeletes: string[] = []
const storedBytes = Buffer.from("normalized-webp-bytes")
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  if (init?.method === "DELETE") {
    storageDeletes.push(...JSON.parse(String(init.body)).prefixes)
    return new Response(null, { status: 200 })
  }
  return new Response(new Uint8Array(storedBytes), { status: 200 })
}
const db = await import("../lib/db.ts")
after(async () => { globalThis.fetch = originalFetch; await pg.close() })

let n = 0
const uuid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`
const media = (id: string) => `/api/media/${id}.webp`
async function user(id: string, username = id) {
  await pg.query("INSERT INTO users(id,created_at,username) VALUES($1,0,$2)", [id, username])
}
async function post(owner: string) {
  const id = uuid()
  await pg.query("INSERT INTO user_posts(id,user_id,data_url,created_at) VALUES($1,$2,$3,0)", [id, owner, media(uuid())])
  return id
}
const reportRow = async (id: string) => (await pg.query<Record<string, unknown>>("SELECT * FROM reports WHERE id=$1", [id])).rows[0]

test("migration 0018 backfills existing match and account reports without losing history", async () => {
  const legacy = new PGlite()
  await legacy.exec("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL)")
  const last = MIGRATIONS.findIndex((m) => m.id === "0018_unified_report_targets")
  for (const migration of MIGRATIONS.slice(0, last)) await legacy.exec(`BEGIN; ${migration.sql} COMMIT;`)
  await legacy.exec(`INSERT INTO reports(id,reporter_id,reported_id,category,details,match_id,status,created_at)
    VALUES('old-match','a','b','harassment','threat','room-1','reviewed',1),('old-user','a','c','spam',NULL,NULL,'pending',2)`)
  for (const migration of MIGRATIONS.slice(last)) await legacy.exec(`BEGIN; ${migration.sql} COMMIT;`)
  const rows = (await legacy.query<Record<string, unknown>>("SELECT id,target_type,target_id,details,status,match_id FROM reports ORDER BY id")).rows
  assert.deepEqual(rows, [
    { id: "old-match", target_type: "match", target_id: "room-1", details: "threat", status: "reviewed", match_id: "room-1" },
    { id: "old-user", target_type: "user", target_id: "c", details: null, status: "pending", match_id: null },
  ])
  // An older app instance inserting without the new columns still gets a classified target.
  await legacy.exec("INSERT INTO reports(id,reporter_id,reported_id,category,match_id,status,created_at) VALUES('rolling','a','b','spam','room-2','pending',3)")
  assert.deepEqual((await legacy.query("SELECT target_type,target_id FROM reports WHERE id='rolling'")).rows[0], { target_type: "match", target_id: "room-2" })
  await assert.rejects(legacy.exec("INSERT INTO reports(id,reporter_id,reported_id,category,status,created_at,target_type,target_id) VALUES('bad','a','b','spam','pending',4,'album','x')"))
  await assert.rejects(legacy.exec("INSERT INTO reports(id,reporter_id,reported_id,category,status,created_at,target_type,target_id) VALUES('spoof','a','b','spam','pending',4,'user','someone-else')"))
  await legacy.close()
})

test("post reports resolve the owner server-side and reject own, invalid and deleted posts", async () => {
  await user("post-reporter"); await user("post-owner"); await user("bystander")
  const postId = await post("post-owner")
  const id = await db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: postId, category: "harassment", details: "abusive caption" })
  const row = await reportRow(id)
  assert.equal(row.reported_id, "post-owner", "owner comes from user_posts, not the client")
  assert.equal(row.target_type, "post"); assert.equal(row.target_id, postId)
  assert.match(String(row.content_reference), /^\/api\/media\//)
  assert.equal(row.match_id, null)

  // A client cannot redirect the report: only type + id reach resolution.
  const spoofed = await db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: postId, category: "spam",
    ...{ reportedUserId: "bystander", reportedId: "bystander" } } as Parameters<typeof db.fileTargetedReport>[0])
  assert.equal((await reportRow(spoofed)).reported_id, "post-owner")

  await assert.rejects(db.fileTargetedReport({ reporterId: "post-owner", targetType: "post", targetId: postId, category: "spam" }), /cannot_report_self/)
  await assert.rejects(db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: "../../etc", category: "spam" }), /invalid_target/)
  await assert.rejects(db.fileTargetedReport({ reporterId: "post-reporter", targetType: "album", targetId: postId, category: "spam" }), /invalid_target/)
  await assert.rejects(db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: uuid(), category: "spam" }), /content_unavailable/)
  const gone = await post("post-owner")
  await db.removePost("post-owner", gone)
  await assert.rejects(db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: gone, category: "spam" }), /content_unavailable/)
  // NCII is never accepted as an ordinary category.
  await assert.rejects(db.fileTargetedReport({ reporterId: "post-reporter", targetType: "post", targetId: postId, category: "intimate_image" }), /invalid_target/)

  const evidence = await db.getReportEvidence(id, "reviewer")
  const history = evidence!.history as { target: { type: string; id: string; contentReference: string; reportedAt: number } }
  assert.equal(history.target.type, "post"); assert.equal(history.target.id, postId)
  assert.equal(history.target.contentReference, row.content_reference)
  assert.ok(Number.isSafeInteger(history.target.reportedAt))
  assert.equal(await db.getReportEvidence(id, "post-owner"), null, "the reported account can never read evidence")
})

test("duplicate submissions are deduplicated per target and category, updated reports are not", async () => {
  await user("dup-reporter"); await user("dup-owner")
  const postId = await post("dup-owner")
  const first = await db.fileTargetedReport({ reporterId: "dup-reporter", targetType: "post", targetId: postId, category: "spam" })
  assert.equal(await db.fileTargetedReport({ reporterId: "dup-reporter", targetType: "post", targetId: postId, category: "spam" }), first)
  assert.notEqual(await db.fileTargetedReport({ reporterId: "dup-reporter", targetType: "post", targetId: postId, category: "hate" }), first)
  assert.notEqual(await db.fileTargetedReport({ reporterId: "dup-reporter", targetType: "post", targetId: postId, category: "spam", details: "More context" }), first)
  // Same account/category against the account itself is a different target.
  assert.notEqual(await db.fileTargetedReport({ reporterId: "dup-reporter", targetType: "user", targetId: "dup-owner", category: "spam" }), first)
})

test("report volume per account is rate limited", async () => {
  await user("flood-reporter"); await user("flood-target")
  for (let i = 0; i < 20; i++) await db.fileTargetedReport({ reporterId: "flood-reporter", targetType: "user", targetId: "flood-target", category: "other", details: `note ${i}` })
  await assert.rejects(db.fileTargetedReport({ reporterId: "flood-reporter", targetType: "user", targetId: "flood-target", category: "other", details: "one more" }), /rate_limited/)
})

test("existing user, live-match and recent-match reports keep working with explicit targets", async () => {
  await user("u-reporter"); await user("u-target", "utarget")
  const byUsername = await db.fileTargetedReport({ reporterId: "u-reporter", targetType: "user", targetId: "UTarget", category: "scam" })
  assert.deepEqual([(await reportRow(byUsername)).target_type, (await reportRow(byUsername)).target_id, (await reportRow(byUsername)).reported_id], ["user", "u-target", "u-target"])
  await assert.rejects(db.fileTargetedReport({ reporterId: "u-target", targetType: "user", targetId: "utarget", category: "scam" }), /cannot_report_self/)

  // The socket paths (in-call "report", "user-report") still call fileReport directly.
  const live = await db.fileReport({ reporterId: "u-reporter", reportedId: "u-target", category: "harassment", matchId: "live-room",
    chatContext: [{ senderId: "u-target", text: "in-call text", timestamp: Date.now() }] })
  assert.deepEqual([(await reportRow(live)).target_type, (await reportRow(live)).target_id], ["match", "live-room"])
  assert.equal(((await db.getReportEvidence(live, "reviewer"))!.chat_context as unknown[]).length, 1, "bounded in-call chat evidence is kept")
  const direct = await db.fileReport({ reporterId: "u-reporter", reportedId: "u-target", category: "hate" })
  assert.equal((await reportRow(direct)).target_type, "user")

  await db.recordMatchStart({ matchId: "recent-unified", userAId: "u-reporter", userBId: "u-target", source: "random", startedAt: Date.now() - 1000 })
  await db.recordMatchEnd("recent-unified")
  const recent = await db.fileRecentMatchReport({ reporterId: "u-reporter", matchId: "recent-unified", category: "violence" })
  assert.deepEqual([(await reportRow(recent)).target_type, (await reportRow(recent)).reported_id], ["match", "u-target"])
  const viaApi = await db.fileTargetedReport({ reporterId: "u-reporter", targetType: "match", targetId: "recent-unified", category: "spam" })
  assert.equal((await reportRow(viaApi)).match_id, "recent-unified")
  await assert.rejects(db.fileTargetedReport({ reporterId: "bystander", targetType: "match", targetId: "recent-unified", category: "spam" }), /match_not_reportable/)
})

test("message reports are limited to messages delivered to the reporter", async () => {
  await user("m-a"); await user("m-b")
  await pg.exec("INSERT INTO friendships(id,user_a_id,user_b_id,created_at) VALUES('m-friends','m-a','m-b',0)")
  await db.sendFriendMessage("m-b", "m-friends", "client-m1", "a threatening message")
  const messageId = (await pg.query<{ id: string }>("SELECT id FROM friend_messages WHERE client_message_id='client-m1'")).rows[0].id
  await assert.rejects(db.fileTargetedReport({ reporterId: "m-b", targetType: "message", targetId: messageId, category: "harassment" }), /content_unavailable/)
  const id = await db.fileTargetedReport({ reporterId: "m-a", targetType: "message", targetId: messageId, category: "harassment" })
  assert.equal((await reportRow(id)).reported_id, "m-b")
  const history = (await db.getReportEvidence(id, "reviewer"))!.history as { target: { message: { text: string } } }
  assert.equal(history.target.message.text, "a threatening message")
})

test("admin queue shows each report's target with post context", async () => {
  await user("q-reporter"); await user("q-owner", "qowner")
  const postId = await post("q-owner")
  const id = await db.fileTargetedReport({ reporterId: "q-reporter", targetType: "post", targetId: postId, category: "violence" })
  const row = (await db.listReports("pending")).find((r) => r.id === id)!
  assert.equal(row.target_type, "post"); assert.equal(row.target_id, postId)
  assert.equal(row.reported_username, "qowner")
  assert.equal(row.target_available, true)
  assert.match(String(row.post_image), /^\/api\/media\//)
  assert.equal(typeof row.prior_reports, "number")
})

test("content removal deletes the post, queues Storage deletion and never penalizes the account", async () => {
  await user("r-reporter"); await user("r-owner"); await user("r-admin")
  const postId = await post("r-owner")
  const reference = (await pg.query<{ data_url: string }>("SELECT data_url FROM user_posts WHERE id=$1", [postId])).rows[0].data_url
  const id = await db.fileTargetedReport({ reporterId: "r-reporter", targetType: "post", targetId: postId, category: "sexual_content" })
  storageDeletes.length = 0
  await db.resolveReport(id, "r-admin", "no_action", null, null, { removeContent: true })
  assert.equal((await pg.query("SELECT 1 FROM user_posts WHERE id=$1", [postId])).rows.length, 0, "DB reference removed")
  assert.deepEqual(storageDeletes, [reference.slice("/api/media/".length)], "Storage object deleted through the deletion queue")
  assert.equal((await pg.query("SELECT 1 FROM image_deletion_queue WHERE reference=$1", [reference])).rows.length, 0)
  const status = await db.getUserStatus("r-owner")
  assert.equal(status.banned, false); assert.equal(status.suspendedUntil, null)
  assert.deepEqual((await pg.query<{ action: string }>("SELECT action FROM moderation_actions WHERE report_id=$1", [id])).rows.map((r) => r.action), ["no_action"])
  assert.deepEqual((await db.listAppealableEnforcements("r-owner")), [], "a content-only decision creates nothing to appeal")
  const audit = (await pg.query<Record<string, unknown>>("SELECT * FROM content_removals WHERE report_id=$1", [id])).rows[0]
  assert.equal(audit.target_id, postId); assert.equal(audit.target_user_id, "r-owner"); assert.equal(audit.content_reference, reference)
  const report = await reportRow(id)
  assert.equal(report.content_reference, reference, "the report still explains what was acted on after removal")
  assert.equal((await db.listReports("reviewed")).find((r) => r.id === id)!.target_available, false)

  // Removal + account enforcement are combinable but separate.
  const second = await post("r-owner")
  const secondReport = await db.fileTargetedReport({ reporterId: "r-reporter", targetType: "post", targetId: second, category: "hate" })
  await db.resolveReport(secondReport, "r-admin", "suspend", "Repeated violations", Date.now() + 86_400_000, { removeContent: true })
  assert.equal((await pg.query("SELECT 1 FROM user_posts WHERE id=$1", [second])).rows.length, 0)
  assert.ok((await db.getUserStatus("r-owner")).suspendedUntil! > Date.now())

  // Content actions apply only to removable content.
  const userReport = await db.fileTargetedReport({ reporterId: "r-reporter", targetType: "user", targetId: "r-owner", category: "spam" })
  await assert.rejects(db.resolveReport(userReport, "r-admin", "no_action", null, null, { removeContent: true }), /unsupported_content_action/)
  assert.equal((await reportRow(userReport)).status, "pending", "a failed content action rolls back the whole decision")
})

test("removeReportedContent validates its target and respects legal holds", async () => {
  await user("h-owner"); await user("h-admin")
  await assert.rejects(db.removeReportedContent({ targetType: "post", targetId: uuid(), reason: "x", actorId: "h-admin" }), /content_unavailable/)
  await assert.rejects(db.removeReportedContent({ targetType: "user", targetId: "h-owner", reason: "x", actorId: "h-admin" }), /unsupported_content_action/)
  const postId = await post("h-owner")
  await assert.rejects(db.removeReportedContent({ targetType: "post", targetId: postId, reason: "x", actorId: "h-owner" }), /conflicted_reviewer/)
  const reference = (await pg.query<{ data_url: string }>("SELECT data_url FROM user_posts WHERE id=$1", [postId])).rows[0].data_url
  const hold = await db.setLegalHold("reviewer", "case-hold-post", "Preservation required")
  storageDeletes.length = 0
  await db.removeReportedContent({ targetType: "post", targetId: postId, reason: "Policy violation", actorId: "h-admin" })
  assert.equal((await pg.query("SELECT 1 FROM user_posts WHERE id=$1", [postId])).rows.length, 0, "content is still taken down under a hold")
  assert.deepEqual(storageDeletes, [], "no destructive Storage deletion while a hold is active")
  assert.equal((await pg.query("SELECT 1 FROM image_deletion_queue WHERE reference=$1", [reference])).rows.length, 1, "deletion stays queued")
  assert.equal((await pg.query("SELECT 1 FROM held_records WHERE table_name='user_posts' AND record_id=$1", [postId])).rows.length, 1, "pre-removal record preserved")
  await db.setLegalHold("reviewer", "case-hold-release", "Obligation ended", hold)
})

test("NCII requests open a dedicated case instead of only an ordinary report", async () => {
  await user("n-requester"); await user("n-owner", "nowner"); await user("n-reviewer")
  const postId = await post("n-owner")
  const reference = (await pg.query<{ data_url: string }>("SELECT data_url FROM user_posts WHERE id=$1", [postId])).rows[0].data_url
  const input = { requesterId: "n-requester", targetType: "post", targetId: postId, relationship: "depicted_person" as const,
    signatureName: "Pat Example", contact: "pat@example.invalid", goodFaith: true }
  await assert.rejects(db.fileNciiRequest({ ...input, goodFaith: false }), /invalid_request/)
  await assert.rejects(db.fileNciiRequest({ ...input, targetType: "user", targetId: "nowner" }), /description_required/)
  const caseId = await db.fileNciiRequest(input)
  assert.equal(await db.fileNciiRequest(input), caseId, "an open duplicate returns the same case")

  const row = (await pg.query<Record<string, unknown>>("SELECT * FROM ncii_cases WHERE id=$1", [caseId])).rows[0]
  assert.equal(row.reported_user_id, "n-owner"); assert.equal(row.content_reference, reference); assert.equal(row.status, "received")
  assert.equal(row.image_sha256, createHash("sha256").update(storedBytes).digest("hex"))
  assert.ok(Number(row.removal_due_at) > Number(row.received_at))
  const linked = await reportRow(String(row.report_id))
  assert.deepEqual([linked.category, linked.priority, linked.target_type, linked.details], ["intimate_image", "urgent", "post", null])
  assert.equal((await pg.query("SELECT 1 FROM user_posts WHERE id=$1", [postId])).rows.length, 1, "nothing is removed merely because a request was filed")

  assert.equal(await db.getNciiCase(caseId, "n-owner"), null, "the reported account cannot open the case")
  assert.equal((await db.listNciiCases("n-owner")).length, 0)
  assert.equal((await db.getNciiCase(caseId, "n-reviewer"))!.signatureName, "Pat Example")
  assert.equal((await pg.query("SELECT 1 FROM safety_decisions WHERE decision='ncii_case_access' AND case_reference=$1", [caseId])).rows.length, 1, "views are audited")

  // Ordinary moderation cannot remove content for an NCII-linked report.
  await assert.rejects(db.resolveReport(String(row.report_id), "n-reviewer", "no_action", null, null, { removeContent: true }), /ncii_case_required/)
  await assert.rejects(db.reviewNciiCase({ caseId, actorId: "n-owner", outcome: "rejected", rationale: "x" }), /conflicted_reviewer/)
  await db.reviewNciiCase({ caseId, actorId: "n-reviewer", outcome: "valid_remove", rationale: "Requester is shown; no consent" })
  assert.equal((await pg.query("SELECT 1 FROM user_posts WHERE id=$1", [postId])).rows.length, 0)
  const decided = (await pg.query<Record<string, unknown>>("SELECT status,reviewer_id FROM ncii_cases WHERE id=$1", [caseId])).rows[0]
  assert.deepEqual(decided, { status: "removed", reviewer_id: "n-reviewer" })
  assert.equal((await pg.query("SELECT 1 FROM content_removals WHERE ncii_case_id=$1", [caseId])).rows.length, 1)
  assert.equal((await db.getUserStatus("n-owner")).banned, false, "account enforcement stays a separate decision")
  assert.equal((await db.listReports("pending")).some((r) => r.id === row.report_id && r.ncii_case_id === caseId), true)
  await assert.rejects(db.reviewNciiCase({ caseId, actorId: "n-reviewer", outcome: "rejected", rationale: "again" }), /case_already_decided/)
})

test("retention never purges a report linked to an NCII case", async () => {
  const { ciLaunchFixture } = await import("../scripts/ci-launch-fixture.mjs")
  process.env.RETENTION_POLICY_JSON = ciLaunchFixture.RETENTION_POLICY_JSON
  await user("p-requester"); await user("p-owner"); await user("p-reviewer")
  const postId = await post("p-owner")
  const caseId = await db.fileNciiRequest({ requesterId: "p-requester", targetType: "post", targetId: postId, relationship: "authorized_representative",
    signatureName: "Rep Example", contact: "rep@example.invalid", goodFaith: true })
  const reportId = String((await pg.query<{ report_id: string }>("SELECT report_id FROM ncii_cases WHERE id=$1", [caseId])).rows[0].report_id)
  await db.resolveReport(reportId, "p-reviewer", "no_action", null, null)
  await pg.query("DELETE FROM moderation_actions WHERE report_id=$1", [reportId])
  await pg.query("DELETE FROM safety_decisions WHERE report_id=$1", [reportId])
  await pg.query("DELETE FROM report_evidence WHERE report_id=$1", [reportId])
  await pg.query("UPDATE reports SET created_at=0 WHERE id=$1", [reportId])
  await db.purgeRetentionBatch(100)
  assert.equal((await pg.query("SELECT 1 FROM reports WHERE id=$1", [reportId])).rows.length, 1)
})
