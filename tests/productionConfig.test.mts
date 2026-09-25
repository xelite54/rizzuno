import { ciLaunchFixture } from "../scripts/ci-launch-fixture.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { validateProductionConfig } from "../lib/productionConfig.ts"
import { databaseConfig } from "../lib/dbConfig.ts"

test("web production validates configuration without leaking invalid inputs", () => {
  const before = {...process.env}
  Object.assign(process.env, ciLaunchFixture, { NODE_ENV:"production", DMCA_AGENT_REGISTERED:"true", PROVIDER_REGION_DISCLOSURE_REVIEWED:"true",TRAINED_SAFETY_REVIEWERS_CONFIRMED:"true",CYBERTIPLINE_PROCEDURE_APPROVED:"true",BREACH_RESPONSE_APPROVED:"true",US_STATE_LAUNCH_REVIEW_APPROVED:"true", BILLING_MODE:"free_test", DATABASE_URL:"postgres://server:p%40ss%3Aword%2F%25@db.invalid/app", AUTH_SECRET:"a".repeat(32),AUTH_GOOGLE_ID:"google",AUTH_GOOGLE_SECRET:"secret",AUTH_URL:"https://app.invalid",APP_URL:"https://app.invalid",REALTIME_TICKET_SECRET:"b".repeat(32),NEXT_PUBLIC_WS_URL:"wss://realtime.invalid/ws", SIGHTENGINE_API_USER:"user",SIGHTENGINE_API_SECRET:"secret", NEXT_PUBLIC_TURN_URL:"turn:relay.invalid:3478",TURN_STATIC_AUTH_SECRET:"test-only", IMAGE_STORAGE_URL:"https://storage.invalid",IMAGE_STORAGE_KEY:"test-only",IMAGE_STORAGE_BUCKET:"images" })
  delete process.env.DATABASE_SSL_CA; delete process.env.NEXT_PUBLIC_TURN_USERNAME; delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL
  try {
    validateProductionConfig("web")
    assert.equal(new URL(databaseConfig(process.env.DATABASE_URL!).connectionString!).password,"p%40ss%3Aword%2F%25")
    for (const key of ["AUTH_SECRET","AUTH_GOOGLE_ID","AUTH_GOOGLE_SECRET","AUTH_URL","APP_URL","DATABASE_URL","REALTIME_TICKET_SECRET","NEXT_PUBLIC_WS_URL","SIGHTENGINE_API_USER","SIGHTENGINE_API_SECRET","NEXT_PUBLIC_TURN_URL","TURN_STATIC_AUTH_SECRET","IMAGE_STORAGE_KEY"]) {
      const value=process.env[key]; delete process.env[key]; assert.throws(() => validateProductionConfig("web")); process.env[key]=value
    }
    process.env.AUTH_URL="secret-value-not-a-url"
    assert.throws(() => validateProductionConfig("web"), e => e instanceof Error && !e.message.includes("secret-value"))
    process.env.AUTH_URL="https://app.invalid"; process.env.DATABASE_SSL_CA_REQUIRED="true"
    assert.throws(() => validateProductionConfig("web"), /DATABASE_SSL_CA/)
    process.env.DATABASE_SSL_CA="-----BEGIN CERTIFICATE-----invalid"
    assert.throws(() => validateProductionConfig("web"), /DATABASE_SSL_CA/)
  } finally { for(const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env,before) }
})
