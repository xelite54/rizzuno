import { test } from "node:test"
import assert from "node:assert/strict"
import { stagingTargets } from "./load/stagingGuard.mts"
test("remote load refuses production, unacknowledged targets and credential URLs",()=>{
  const env={LOAD_ENVIRONMENT:"staging",LOAD_WRITES_APPROVED:"true",STAGING_HTTP_ORIGIN:"https://staging.example.invalid",STAGING_WS_URL:"wss://realtime.staging.example.invalid/ws",STAGING_TARGET_ACK:"https://staging.example.invalid",STAGING_PROBE_SECRET:"x".repeat(32)}
  assert.ok(stagingTargets(env))
  for(const mutation of [{LOAD_ENVIRONMENT:"production"},{LOAD_WRITES_APPROVED:"false"},{STAGING_HTTP_ORIGIN:"https://www.example.invalid"},{STAGING_WS_URL:"wss://www.example.invalid/ws"},{STAGING_TARGET_ACK:"https://other.invalid"},{STAGING_WS_URL:"wss://user:password@staging.example.invalid/ws"}])assert.throws(()=>stagingTargets({...env,...mutation}))
})
