import { readFile } from "node:fs/promises"
import { geographicConfigFingerprint } from "../lib/geographicConfig"

// Use files containing ONLY the five non-secret policy keys. Never pull or
// print whole deployment environments. No cloud writes or approvals occur.
try {
  const paths = process.argv.slice(2)
  if (paths.length !== 2) throw new Error("Usage: npm run policy:compare -- <web-policy.json> <realtime-policy.json>")
  const fingerprints = await Promise.all(paths.map(async path => {
    let input: unknown
    try { input = JSON.parse(await readFile(path, "utf8")) } catch { throw new Error("Unable to read a policy JSON file") }
    return geographicConfigFingerprint(input)
  }))
  if (fingerprints[0] !== fingerprints[1]) throw new Error("Web and realtime geographic/age configuration differs; do not release")
  console.log(JSON.stringify({ matching: true, fingerprint: fingerprints[0], note: "Configuration equivalence only; run launch:check separately on both services with actual approvals." }))
} catch (error) {
  console.error(error instanceof Error ? error.message : "Policy comparison failed")
  process.exitCode = 1
}
