import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { PGlite } from "@electric-sql/pglite"
import { MIGRATIONS } from "../lib/migrations.ts"
import { ciLaunchFixture } from "../scripts/ci-launch-fixture.mjs"
const pg = new PGlite()
await pg.exec("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL)")
for (const migration of MIGRATIONS) {
  await pg.exec(`BEGIN; ${migration.sql} COMMIT;`)
  await pg.query("INSERT INTO schema_migrations VALUES($1,0)",[migration.id])
}
async function query(sql:string,params?:unknown[]) {
  const result = await pg.query(sql,params)
  return { rows:result.rows, rowCount: /^SELECT/i.test(sql.trim()) ? result.rows.length : result.affectedRows ?? result.rows.length }
}
process.env.DATABASE_URL="postgres://localhost/launch-test"
process.env.RETENTION_POLICY_JSON=ciLaunchFixture.RETENTION_POLICY_JSON
const require=createRequire(import.meta.url)
require("pg").Pool=class { on(){return this} query=query; async connect(){return {query,release(){}}} }
const db=await import("../lib/db.ts")
after(()=>pg.close())
test("report snapshots are deduplicated, server-linked and urgent investigations remain queued after suspension",async()=>{
  await pg.exec("INSERT INTO users(id,created_at) VALUES('reporter',0),('target',0)")
  const input={reporterId:"reporter",reportedId:"target",category:"underage_concern",matchId:"room-one",chatContext:[{senderId:"target",text:"relevant",timestamp:Date.now()},{senderId:"unrelated",text:"excluded",timestamp:Date.now()}]}
  const id=await db.fileReport(input)
  assert.equal(await db.fileReport(input),id)
  const evidence=await db.getReportEvidence(id,"reviewer")
  assert.equal((evidence!.chat_context as unknown[]).length,1)
  assert.equal(evidence!.screenshot_state,"not_captured")
  assert.equal(await db.getReportEvidence(id,"target"),null,"even a moderator cannot view evidence about their own reported account")
  await db.resolveReport(id,"reviewer","suspend","Credible age concern",Date.now()+86_400_000)
  assert.ok((await db.listReports("pending")).some(row=>row.id===id))
  const enforcement=(await pg.query<{id:string}>("SELECT id FROM moderation_actions WHERE report_id=$1",[id])).rows[0].id
  const appealId=await db.submitAppeal({userId:"target",enforcementId:enforcement,reason:"I meet the eligibility requirement",evidenceReference:"case-user-1"})
  assert.equal((await db.listUserAppeals("target"))[0].id,appealId)
  await assert.rejects(db.submitAppeal({userId:"reporter",enforcementId:enforcement,reason:"not mine"}),/appealable/)
  await db.resolveAppeal({appealId,actorAdminId:"appeal-reviewer",outcome:"overturned",resolution:"The enforcement was reversed after review."})
  assert.equal((await db.getUserStatus("target")).suspendedUntil,null)
  assert.equal((await db.listUserAppeals("target"))[0].status,"overturned")
  await db.recordSafetyDecision({reportId:id,actorId:"reviewer",decision:"investigation_closed",caseReference:"case-123",rationale:"Reviewed"})
  assert.ok(!(await db.listReports("pending")).some(row=>row.id===id))
})
test("recent-match reports derive the target from the private server ledger",async()=>{
  await pg.exec("INSERT INTO users(id,created_at,username) VALUES('recent-a',0,'recenta'),('recent-b',0,'recentb'),('recent-c',0,'recentc')")
  await db.recordMatchStart({matchId:"recent-room",userAId:"recent-a",userBId:"recent-b",source:"random",startedAt:Date.now()-1000})
  await db.recordMatchEnd("recent-room")
  const recent=await db.listRecentMatchesForReporting("recent-a")
  assert.equal(recent[0].username,"recentb")
  assert.equal("userId" in recent[0],false)
  await assert.rejects(db.fileRecentMatchReport({reporterId:"recent-c",matchId:"recent-room",category:"harassment"}),/not_reportable/)
  const reportId=await db.fileRecentMatchReport({reporterId:"recent-a",matchId:"recent-room",category:"harassment",details:"Threats"})
  const report=await db.getReport(reportId)
  assert.equal(report?.reported_id,"recent-b")
  assert.equal((await db.listRecentMatchesForReporting("recent-a"))[0].reported,true)
})
test("holds block purges/erasure and preserve user changes without breaking block controls",async()=>{
  await pg.exec("INSERT INTO users(id,created_at,bio) VALUES('held',0,'original')")
  const hold=await db.setLegalHold("reviewer","case-held","Preservation required")
  await assert.rejects(db.eraseUserData("held","admin","case-held"),/active_legal_hold/)
  assert.equal((await db.purgeRetentionBatch(1)).held,true)
  await db.updateOwnProfile("held",{bio:"changed"})
  const records=await pg.query<{snapshot:{bio:string}}>("SELECT snapshot FROM held_records WHERE record_id='held'")
  assert.equal(records.rows[0].snapshot.bio,"original")
  await db.setLegalHold("reviewer","case-release","Obligation ended",hold)
  await db.eraseUserData("held","admin","case-erase")
  assert.equal((await db.getUserStatus("held")).deleted,true)
  await assert.rejects(db.updateOwnProfile("held",{bio:"reentry"}),/account_unavailable/)
  await assert.rejects(db.addPost("held","data:image/png;base64,test"),/account_unavailable/)
  const audit=await pg.query<{retained:unknown}>("SELECT retained FROM privacy_operations WHERE user_id='held' AND action='erase'")
  assert.ok(audit.rows[0].retained)
})
test("bounded message expiry preserves reply integrity and blocks stale friendship writes",async()=>{
  await pg.exec("INSERT INTO users(id,created_at) VALUES('a',0),('b',0); INSERT INTO friendships(id,user_a_id,user_b_id,created_at) VALUES('friendship','a','b',0)")
  await pg.exec("INSERT INTO friend_messages(id,friendship_id,sender_id,recipient_id,text,client_message_id,created_at) VALUES('root','friendship','a','b','first','client-a',0)")
  await pg.exec("INSERT INTO friend_messages(id,friendship_id,sender_id,recipient_id,text,client_message_id,created_at,reply_to_id) VALUES('reply','friendship','b','a','reply','client-b',0,'root')")
  await db.purgeRetentionBatch(1)
  assert.deepEqual((await pg.query<{id:string}>("SELECT id FROM friend_messages")).rows.map(row=>row.id),["root"])
  await db.purgeRetentionBatch(1)
  assert.equal((await pg.query("SELECT id FROM friend_messages")).rows.length,0)
  await db.addBlock("a","b")
  await assert.rejects(pg.exec("INSERT INTO friend_messages(id,friendship_id,sender_id,recipient_id,text,client_message_id,created_at) VALUES('stale','friendship','a','b','bad','client-c',0)"),/blocked/)
})
test("standard export includes accessible received messages but excludes peer IDs and evidence",async()=>{
  await pg.exec("INSERT INTO users(id,created_at) VALUES('export-a',0),('export-b',0); INSERT INTO friendships(id,user_a_id,user_b_id,created_at) VALUES('export-friend','export-a','export-b',0)")
  await db.sendFriendMessage("export-b","export-friend","client-export","received")
  const result=await db.exportUserData("export-a","admin","case-export")
  assert.equal(result.messages[0].text,"received")
  assert.equal('sender_id' in result.messages[0],false)
  assert.equal('reports' in result,false)
  assert.ok(Array.isArray(result.recentMatches))
  assert.ok(Array.isArray(result.appeals))
})

test("live eligibility requires current legal versions and keeps prior acceptance records",async()=>{
  await pg.exec("INSERT INTO users(id,created_at) VALUES('legal-user',0); INSERT INTO legal_acceptance(id,user_id,document,version,accepted_at) VALUES('old-acceptance','legal-user','terms','historical-version',0)")
  assert.equal((await db.realtimeAccess(['legal-user'])).get('legal-user'),'acceptance_required')
  await db.recordAcceptance('legal-user')
  assert.equal((await db.realtimeAccess(['legal-user'])).get('legal-user'),'allowed')
  assert.equal((await pg.query("SELECT id FROM legal_acceptance WHERE id='old-acceptance'")).rows.length,1)
  await db.eraseUserData('legal-user','admin','case-legal')
  assert.equal((await db.realtimeAccess(['legal-user'])).get('legal-user'),'banned')
})
