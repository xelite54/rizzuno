import { test } from "node:test"
import assert from "node:assert/strict"
import { geographicConfigFingerprint } from "../lib/geographicConfig.ts"

const review = { status: "approved", mode: "provider", minimumAge: 20, reference: "synthetic test only", reviewBy: "2099-01-01" }
const env = { SUPPORTED_COUNTRIES: "US,JP", SUPPORTED_US_REGIONS: "NY", SUPPORTED_SUBDIVISIONS_JSON: '{"JP":["27","13"]}', AGE_POLICIES_JSON: JSON.stringify({ "US-NY": review, "JP-13": review, "JP-27": review }), LAUNCH_GEO_SOURCE: "vercel" }

test("cross-service comparison detects policy drift while tolerating equivalent ordering and state allowlists", () => {
  const hash = geographicConfigFingerprint(env)
  assert.equal(hash, geographicConfigFingerprint({ ...env, SUPPORTED_COUNTRIES: "JP,US,JP", SUPPORTED_US_REGIONS: "", SUPPORTED_SUBDIVISIONS_JSON: '{"US":["NY"],"JP":["13","27"]}', AGE_POLICIES_JSON: JSON.stringify({ "JP-27": review, "JP-13": review, "US-NY": review }) }))
  for (const change of [
    { SUPPORTED_COUNTRIES: "JP" }, { SUPPORTED_US_REGIONS: "TX" },
    { SUPPORTED_SUBDIVISIONS_JSON: '{"JP":["13"]}' },
    ...["minimumAge", "mode", "reference", "reviewBy", "status"].map(key => ({ AGE_POLICIES_JSON: JSON.stringify({ "US-NY": review, "JP-13": { ...review, [key]: "changed" }, "JP-27": review }) })),
  ]) assert.notEqual(hash, geographicConfigFingerprint({ ...env, ...change }))
})

test("policy comparison fails on missing/malformed settings, unknown geolocation and permanent exclusions", () => {
  for (const input of [null, [], {}, { ...env, SUPPORTED_COUNTRIES: "JP,AU" }, { ...env, SUPPORTED_US_REGIONS: undefined }, { ...env, AGE_POLICIES_JSON: "[1]" }, { ...env, LAUNCH_GEO_SOURCE: "forwarded" }]) assert.throws(() => geographicConfigFingerprint(input))
})
