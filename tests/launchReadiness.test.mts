import { test } from "node:test"
import assert from "node:assert/strict"
import { ciLaunchFixture } from "../scripts/ci-launch-fixture.mjs"
import { validateLaunchReadiness, countryAllowed } from "../lib/launchReadiness.ts"
import { retentionPolicy, RETENTION_CATEGORIES } from "../lib/retention.ts"
import { boundedReportChat } from "../lib/reportEvidence.ts"

test("launch gate rejects missing operator decisions, unregistered US process and expired retention approval", () => {
  const env = { ...ciLaunchFixture, NODE_ENV: "production" }
  validateLaunchReadiness(env)
  for (const key of Object.keys(ciLaunchFixture)) {
    const candidate: Record<string,string|undefined> = { ...env }; delete candidate[key]
    assert.throws(() => validateLaunchReadiness(candidate), key)
  }
  for (const category of RETENTION_CATEGORIES) {
    const policy = JSON.parse(env.RETENTION_POLICY_JSON); delete policy.categories[category]
    assert.throws(() => retentionPolicy({ RETENTION_POLICY_JSON: JSON.stringify(policy) }), category)
  }
  const expired = JSON.parse(env.RETENTION_POLICY_JSON); expired.reviewBy = "2000-01-01"
  assert.throws(() => retentionPolicy({RETENTION_POLICY_JSON:JSON.stringify(expired)}), /expired/)
  assert.throws(() => validateLaunchReadiness({...env, LEGAL_GOVERNING_LAW:"unreviewed"}), /review/)
  assert.equal(countryAllowed(null, env),false)
  assert.equal(countryAllowed("CA",env),false)
  assert.equal(countryAllowed("US",env),true)
  assert.throws(() => validateLaunchReadiness({...env,SUPPORTED_COUNTRIES:"US,*"}))
})
test("report text snapshot rejects future/old timestamps and caps count and content", () => {
  const now = 1_000_000
  const result = boundedReportChat(Array.from({length:30},(_,i)=>({senderId:"a",text:"x".repeat(800),timestamp:now-i})),now)
  assert.equal(result.length,20); assert.ok(result.every(entry=>entry.text.length===500))
  assert.deepEqual(boundedReportChat([{senderId:"a",text:"old",timestamp:now-120001},{senderId:"b",text:"future",timestamp:now+1}],now),[])
})
