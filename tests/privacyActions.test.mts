import { test, mock } from "node:test"
import assert from "node:assert/strict"
let session: {user:{id:string;email:string}} | null=null
const calls:unknown[][]=[]
mock.module("@/auth",{exports:{auth:async()=>session}})
mock.module("@/lib/db",{exports:{exportUserData:async(...args:unknown[])=>{calls.push(args);return {}},eraseUserData:async(...args:unknown[])=>{calls.push(args);return {productErased:true,storagePending:0}}}})
mock.module("@/lib/apiRateLimit",{exports:{isRateLimited:async()=>false}})
const {processPrivacyRequest}=await import("../app/admin/privacy/actions.ts")
test("privacy actions require authenticated admin, both attestations and a case; actor is server-derived",async()=>{
  process.env.ADMIN_EMAILS="admin@example.invalid"
  const input={userId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",action:"export" as const,caseReference:"case-123",identityVerified:true,retentionReviewed:true}
  await assert.rejects(processPrivacyRequest(input),/authorized/)
  session={user:{id:"ordinary",email:"ordinary@example.invalid"}};await assert.rejects(processPrivacyRequest(input),/authorized/)
  session={user:{id:"admin-identity",email:"admin@example.invalid"}}
  for(const mutation of [{identityVerified:false},{retentionReviewed:false},{caseReference:""}])await assert.rejects(processPrivacyRequest({...input,...mutation}),/Invalid/)
  assert.equal(calls.length,0)
  await processPrivacyRequest(input);await processPrivacyRequest({...input,action:"erase"})
  assert.deepEqual(calls.map(call=>call.slice(1)),[['admin-identity','case-123'],['admin-identity','case-123']])
})
