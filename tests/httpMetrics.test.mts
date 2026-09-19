import { test } from "node:test"
import assert from "node:assert/strict"
import { withHttpMetrics } from "../lib/httpMetrics.ts"
import { configureObservability, log } from "../lib/observability.ts"
test("handled 5xx and exceptions are counted without forwarding request/error secrets",async()=>{
  const events: unknown[]=[];configureObservability(e=>events.push(e))
  const response=await withHttpMetrics("/api/example",async()=>new Response(null,{status:503}))()
  assert.equal(response.status,503)
  await assert.rejects(withHttpMetrics("/api/example",async()=>{throw new Error("private-secret")})())
  log.error("safe",{email:"private-secret",token:"private-secret",body:"private-secret",status:500})
  const encoded=JSON.stringify(events)
  assert.equal(encoded.includes("private-secret"),false)
  assert.equal(events.length,3)
  configureObservability(()=>{throw new Error("sink failure")})
  assert.doesNotThrow(()=>log.info("safe"))
  configureObservability(()=>{})
})
