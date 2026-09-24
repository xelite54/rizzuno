import { test, mock } from "node:test"
import assert from "node:assert/strict"
let session: {user:{id:string;email:string}} | null=null
let rateLimited=false
const calls: unknown[][]=[]
mock.module("@/auth",{exports:{auth:async()=>session}})
mock.module("@/lib/db",{exports:{getReport:async()=>({priority:"normal"}),resolveReport:async(...args:unknown[])=>{calls.push(args)}}})
mock.module("@/lib/apiRateLimit",{exports:{isRateLimited:async()=>rateLimited}})
mock.module("next/cache",{exports:{revalidatePath:()=>{}}})
const {resolveReportAction}=await import("../app/admin/actions.ts")
test("admin actions reauthorize, limit requests and require serious-enforcement confirmation",async()=>{
  process.env.ADMIN_EMAILS="moderator@example.invalid"
  const form=new FormData();form.set("reportId","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");form.set("action","ban");form.set("actorAdminId","attacker")
  await assert.rejects(resolveReportAction(form),/authorized/)
  session={user:{id:"normal",email:"normal@example.invalid"}};await assert.rejects(resolveReportAction(form),/authorized/)
  session={user:{id:"server-moderator",email:"moderator@example.invalid"}};await assert.rejects(resolveReportAction(form),/Reason/)
  form.set("reason","Reviewed evidence under policy");form.set("confirmEnforcement","yes")
  rateLimited=true;await assert.rejects(resolveReportAction(form),/Rate/);rateLimited=false
  await resolveReportAction(form);assert.equal(calls.length,1);assert.equal(calls[0][1],"server-moderator")
  form.set("reportId","arbitrary-target-user");await assert.rejects(resolveReportAction(form),/Invalid/)
})
