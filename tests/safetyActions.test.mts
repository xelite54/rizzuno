import { test, mock } from "node:test"
import assert from "node:assert/strict"

let session:{user:{id:string}}|null=null
const appealCalls:unknown[]=[]; const reportCalls:unknown[]=[]; const redirects:string[]=[]
mock.module("@/auth",{exports:{auth:async()=>session}})
mock.module("@/lib/apiRateLimit",{exports:{isRateLimited:async()=>false}})
mock.module("@/lib/db",{exports:{
  submitAppeal:async(input:unknown)=>{appealCalls.push(input);return "appeal-id"},
  fileRecentMatchReport:async(input:unknown)=>{reportCalls.push(input);return "report-id"},
}})
mock.module("next/navigation",{exports:{redirect:(path:string)=>{redirects.push(path)}}})

const {submitAppealAction}=await import("../app/appeals/actions.ts")
const {reportRecentMatch}=await import("../app/reports/recent/actions.ts")

test("appeal and recent-report actions derive the user from the authenticated session",async()=>{
  const appeal=new FormData();appeal.set("enforcementId","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");appeal.set("reason","Please review this decision")
  await assert.rejects(submitAppealAction(appeal),/authenticated/)
  session={user:{id:"server-user"}}
  await submitAppealAction(appeal)
  assert.deepEqual(appealCalls[0],{userId:"server-user",enforcementId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",reason:"Please review this decision",evidenceReference:undefined})

  const report=new FormData();report.set("matchId","bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");report.set("category","harassment");report.set("details","threat")
  await reportRecentMatch(report)
  assert.deepEqual(reportCalls[0],{reporterId:"server-user",matchId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",category:"harassment",details:"threat"})
  assert.deepEqual(redirects,["/appeals?submitted=1","/reports/recent?submitted=1"])
})
