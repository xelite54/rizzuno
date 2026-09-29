import { test } from "node:test"
import assert from "node:assert/strict"
import { noticeDestination, noticeMessage, notifySafetyTeam } from "../lib/safetyNotifications.ts"

const env = { SAFETY_NOTICE_EMAIL: "safety@example.invalid", RESEND_API_KEY: "test-key", NOTIFICATION_FROM_EMAIL: "alerts@example.invalid", APP_URL: "https://rizzuno.test" }

test("destinations come only from the server environment, NCII falling back to the safety inbox", () => {
  assert.equal(noticeDestination("report", {}), null)
  assert.equal(noticeDestination("report", { SAFETY_NOTICE_EMAIL: "not an email" }), null)
  assert.equal(noticeDestination("ncii", env), "safety@example.invalid")
  assert.equal(noticeDestination("ncii", { ...env, NCII_NOTICE_EMAIL: "ncii@example.invalid" }), "ncii@example.invalid")
  assert.equal(noticeDestination("report", { ...env, NCII_NOTICE_EMAIL: "ncii@example.invalid" }), "safety@example.invalid")
})

test("alerts carry only a reference and restricted admin link", () => {
  const { text } = noticeMessage({ kind: "ncii", caseId: "case-1", targetType: "post", removalDueAt: 0 }, "https://rizzuno.test/")
  assert.match(text, /https:\/\/rizzuno\.test\/admin\/ncii\/case-1/)
  const report = noticeMessage({ kind: "report", reportId: "report-1", category: "underage_concern", targetType: "match", priority: "urgent" })
  assert.match(report.subject, /URGENT/)
})

test("sends to the configured inbox, skips when unconfigured, and never throws", async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = []
  const original = globalThis.fetch
  let fail = false
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    if (fail) throw new Error("network down")
    return new Response("{}", { status: 200 })
  }
  try {
    await notifySafetyTeam({ kind: "report", reportId: "r", category: "spam", targetType: "post", priority: "normal" }, {})
    await notifySafetyTeam({ kind: "report", reportId: "r", category: "spam", targetType: "post", priority: "normal" }, { SAFETY_NOTICE_EMAIL: "safety@example.invalid" })
    assert.equal(sent.length, 0)
    await notifySafetyTeam({ kind: "ncii", caseId: "c", targetType: "post", removalDueAt: 0 }, { ...env, NCII_NOTICE_EMAIL: "ncii@example.invalid" })
    assert.equal(sent[0].url, "https://api.resend.com/emails")
    assert.deepEqual(sent[0].body.to, ["ncii@example.invalid"])
    fail = true
    await notifySafetyTeam({ kind: "ncii", caseId: "c", targetType: "post", removalDueAt: 0 }, env)
  } finally { globalThis.fetch = original }
})
