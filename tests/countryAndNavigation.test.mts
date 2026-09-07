import { test } from "node:test"
import assert from "node:assert/strict"
import { countryLabel, normalizeCountry, requestCountry } from "../lib/country.ts"
import { safeUpgradeReturn } from "../lib/upgradeNavigation.ts"
import { mintTicket, verifyTicket } from "../lib/realtimeTicket.ts"

test("country flags cover countries without guessing unknown locations", () => {
  assert.equal(countryLabel("US")?.flag, "🇺🇸")
  assert.equal(countryLabel("kr")?.flag, "🇰🇷")
  assert.equal(countryLabel("BR")?.name, "Brazil")
  assert.equal(normalizeCountry("XX"), null)
  assert.equal(countryLabel(null), null)
})
test("country comes only from platform headers and is signed into the ticket", () => {
  const oldPlatform = process.env.VERCEL
  const oldSecret = process.env.REALTIME_TICKET_SECRET
  try {
    process.env.REALTIME_TICKET_SECRET = "country-test-only-secret"
    delete process.env.VERCEL
    const request = new Request("https://rizzuno.com", { headers: { "x-vercel-ip-country": "US" } })
    assert.equal(requestCountry(request), null)
    process.env.VERCEL = "1"
    assert.equal(requestCountry(request), "US")
    const ticket = mintTicket("user", "US")
    assert.deepEqual(verifyTicket(ticket), { userId: "user", countryCode: "US" })
    const [payload, signature] = ticket.split(".")
    const tampered = Buffer.from(Buffer.from(payload, "base64url").toString().replace("US", "GB")).toString("base64url")
    assert.equal(verifyTicket(`${tampered}.${signature}`), null)
  } finally {
    if (oldPlatform === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldPlatform
    if (oldSecret === undefined) delete process.env.REALTIME_TICKET_SECRET; else process.env.REALTIME_TICKET_SECRET = oldSecret
  }
})
test("upgrade returns restore internal panels, never external URLs", () => {
  assert.equal(safeUpgradeReturn("/?panel=profile&view=edit"), "/?panel=profile&view=edit")
  assert.equal(safeUpgradeReturn("/?panel=friends&search=alex"), "/?panel=friends&search=alex")
  for (const value of [null, "https://evil.example", "//evil.example", "/\\evil.example", "/?panel=evil"]) assert.equal(safeUpgradeReturn(value), "/")
})
