import { test } from "node:test"
import assert from "node:assert/strict"
import { mintTurnCredential, verifyMintedTurnCredential, turnCredentialsConfigured, TURN_CREDENTIAL_TTL_SECONDS } from "../lib/turnCredentials"

const ENV_KEYS = ["NEXT_PUBLIC_TURN_URL", "TURN_STATIC_AUTH_SECRET"] as const

function withTurnEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const previous = ENV_KEYS.map((key) => process.env[key])
  try {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    }
    fn()
  } finally {
    ENV_KEYS.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
  }
}

test("unconfigured (neither var set) mints nothing and reports not configured", () => {
  withTurnEnv({}, () => {
    assert.equal(turnCredentialsConfigured(), false)
    assert.equal(mintTurnCredential("label"), null)
  })
})

test("a TURN url with no auth secret still mints nothing — both are required", () => {
  withTurnEnv({ NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478" }, () => {
    assert.equal(turnCredentialsConfigured(), false)
    assert.equal(mintTurnCredential("label"), null)
  })
})

test("an auth secret with no TURN url still mints nothing — both are required", () => {
  withTurnEnv({ TURN_STATIC_AUTH_SECRET: "shared-secret" }, () => {
    assert.equal(turnCredentialsConfigured(), false)
    assert.equal(mintTurnCredential("label"), null)
  })
})

test("both configured: mints a credential a real TURN REST API implementation would accept", () => {
  withTurnEnv({ NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478,turns:relay.example:5349", TURN_STATIC_AUTH_SECRET: "shared-secret" }, () => {
    assert.equal(turnCredentialsConfigured(), true)
    const minted = mintTurnCredential("some-label")
    assert.ok(minted)
    assert.deepEqual(minted!.urls, ["turn:relay.example:3478", "turns:relay.example:5349"])
    assert.equal(minted!.ttlSeconds, TURN_CREDENTIAL_TTL_SECONDS)
    assert.match(minted!.username, /^\d+:some-label$/)
    assert.ok(minted!.credential.length > 0, "a real HMAC digest, never empty")

    // The one thing that actually matters: a real TURN server, given only
    // its own copy of the shared secret, must be able to independently
    // recompute the same credential and accept it.
    assert.equal(verifyMintedTurnCredential(minted!.username, minted!.credential, "shared-secret"), true)
    // The wrong secret (a real TURN server that was never given this
    // deployment's own secret) must reject it.
    assert.equal(verifyMintedTurnCredential(minted!.username, minted!.credential, "a-different-secret"), false)
    // A tampered credential must be rejected too.
    assert.equal(verifyMintedTurnCredential(minted!.username, "tampered-credential", "shared-secret"), false)
  })
})

test("each minted credential's username embeds a genuinely future expiry, honored by verification", () => {
  withTurnEnv({ NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478", TURN_STATIC_AUTH_SECRET: "shared-secret" }, () => {
    const minted = mintTurnCredential("expiry-check", 60)!
    // Still valid right now.
    assert.equal(verifyMintedTurnCredential(minted.username, minted.credential, "shared-secret", Date.now()), true)
    // Still valid right at the boundary.
    assert.equal(verifyMintedTurnCredential(minted.username, minted.credential, "shared-secret", Date.now() + 59_000), true)
    // Expired once genuinely past its own TTL.
    assert.equal(verifyMintedTurnCredential(minted.username, minted.credential, "shared-secret", Date.now() + 61_000), false)
  })
})

test("never logs or otherwise exposes the raw secret in the minted result", () => {
  withTurnEnv({ NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478", TURN_STATIC_AUTH_SECRET: "a-secret-that-must-never-appear" }, () => {
    const minted = mintTurnCredential("label")!
    const serialized = JSON.stringify(minted)
    assert.ok(!serialized.includes("a-secret-that-must-never-appear"), "the shared secret itself must never appear in what's handed to the client")
  })
})

test("two credentials minted moments apart for the same label differ (expiry is embedded, not a constant)", async () => {
  await withTurnEnvAsync({ NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478", TURN_STATIC_AUTH_SECRET: "shared-secret" }, async () => {
    const first = mintTurnCredential("same-label", 1)!
    await new Promise((r) => setTimeout(r, 1100))
    const second = mintTurnCredential("same-label", 1)!
    assert.notEqual(first.username, second.username)
    assert.notEqual(first.credential, second.credential)
  })
})

async function withTurnEnvAsync(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>) {
  const previous = ENV_KEYS.map((key) => process.env[key])
  try {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    }
    await fn()
  } finally {
    ENV_KEYS.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
  }
}
