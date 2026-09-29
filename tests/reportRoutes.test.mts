import { test, mock } from "node:test"
import assert from "node:assert/strict"

// Route/action layer of the unified reporting model: identity comes from the
// session, only the target reference reaches the database layer, NCII goes
// to its own intake, and responses never carry ids or evidence.
process.env.DATABASE_URL ||= "postgres://test-unused"
let session: { user: { id: string; email?: string } } | null = null
let failWith: string | null = null
const calls: { fn: string; input: unknown }[] = []
const record = (fn: string) => async (...args: unknown[]) => {
  calls.push({ fn, input: args.length === 1 ? args[0] : args })
  if (failWith) throw new Error(failWith)
  return "internal-id-never-returned"
}
mock.module("../auth.ts", { namedExports: { auth: async () => session } })
const dbExports = {
  fileTargetedReport: record("fileTargetedReport"),
  fileNciiRequest: record("fileNciiRequest"),
  getUserStatus: async () => ({ banned: false, deleted: false }),
  describeDbError: () => ({}),
  getReport: async () => ({ priority: "normal" }),
  resolveReport: record("resolveReport"),
  reviewNciiCase: record("reviewNciiCase"),
  getAppealForAdmin: async () => null,
  resolveAppeal: async () => {},
}
mock.module("../lib/db.ts", { namedExports: dbExports })
mock.module("../lib/apiRateLimit.ts", { namedExports: { isRateLimited: async () => false } })
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } })

const { POST: report } = await import("../app/api/reports/route.ts")
const { POST: ncii } = await import("../app/api/reports/ncii/route.ts")
const { resolveReportAction, reviewNciiAction } = await import("../app/admin/actions.ts")
const post = (body: unknown) => new Request("https://rizzuno.com/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

test("report endpoint requires a session and forwards only the target reference", async () => {
  calls.length = 0
  assert.equal((await report(post({ targetType: "post", targetId: POST_ID, category: "spam" }))).status, 401)
  session = { user: { id: "session-reporter" } }
  const response = await report(post({ targetType: "post", targetId: POST_ID, category: "harassment", details: " mean caption ",
    reportedUserId: "victim-chosen-by-client", reporterId: "someone-else", ownerId: "spoof" }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true }, "no report id, owner or evidence in the response")
  assert.deepEqual(calls, [{ fn: "fileTargetedReport", input: { reporterId: "session-reporter", targetType: "post", targetId: POST_ID, category: "harassment", details: "mean caption" } }])
})

test("report endpoint rejects unknown targets/categories and maps missing content safely", async () => {
  session = { user: { id: "session-reporter" } }
  calls.length = 0
  for (const body of [{ targetType: "album", targetId: POST_ID, category: "spam" }, { targetType: "post", targetId: POST_ID, category: "intimate_image" },
    { targetType: "post", targetId: POST_ID, category: "ncii" }, { targetType: "post", category: "spam" }]) {
    assert.equal((await report(post(body))).status, 400)
  }
  assert.equal(calls.length, 0, "NCII is never filed through the ordinary endpoint")
  failWith = "content_unavailable"
  const gone = await report(post({ targetType: "post", targetId: POST_ID, category: "spam" }))
  assert.equal(gone.status, 404); assert.deepEqual(await gone.json(), { error: "content_unavailable" })
  failWith = "cannot_report_self"
  assert.equal((await report(post({ targetType: "post", targetId: POST_ID, category: "spam" }))).status, 400)
  failWith = "rate_limited"
  assert.equal((await report(post({ targetType: "post", targetId: POST_ID, category: "spam" }))).status, 429)
  failWith = null
})

test("the NCII reason branches into the dedicated intake, not an ordinary report", async () => {
  session = { user: { id: "session-requester", email: "requester@example.invalid" } }
  calls.length = 0
  const incomplete = await ncii(post({ targetType: "post", targetId: POST_ID, relationship: "depicted_person", signatureName: "Pat Example" }))
  assert.equal(incomplete.status, 400, "the good-faith statement is required")
  const response = await ncii(post({ targetType: "post", targetId: POST_ID, relationship: "depicted_person", signatureName: "Pat Example", goodFaith: true,
    reportedUserId: "spoof", imageHash: "spoof" }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true }, "no case id, owner, image reference or hash returned to the requester")
  assert.deepEqual(calls.map((call) => call.fn), ["fileNciiRequest"])
  assert.deepEqual(calls[0].input, { requesterId: "session-requester", targetType: "post", targetId: POST_ID, relationship: "depicted_person",
    signatureName: "Pat Example", contact: "requester@example.invalid", description: undefined, goodFaith: true })
})

test("only admins resolve reports, only safety reviewers review NCII, and content action is explicit", async () => {
  process.env.ADMIN_EMAILS = "moderator@example.invalid,safety@example.invalid"
  process.env.SAFETY_REVIEWER_EMAILS = "safety@example.invalid"
  calls.length = 0
  const form = new FormData(); form.set("reportId", POST_ID); form.set("action", "no_action"); form.set("contentAction", "remove")
  session = { user: { id: "normal-user", email: "normal@example.invalid" } }
  await assert.rejects(resolveReportAction(form), /authorized/)
  session = { user: { id: "moderator", email: "moderator@example.invalid" } }
  await resolveReportAction(form)
  assert.deepEqual(calls.at(-1), { fn: "resolveReport", input: [POST_ID, "moderator", "no_action", null, null, { removeContent: true }] }, "remove post only, no account action")
  form.set("contentAction", "delete-everything"); await assert.rejects(resolveReportAction(form), /Invalid/)

  const review = new FormData(); review.set("caseId", POST_ID); review.set("outcome", "valid_remove"); review.set("rationale", "Valid request"); review.set("confirmReview", "yes")
  await assert.rejects(reviewNciiAction(review), /authorized/, "an ordinary admin is not a trained safety reviewer")
  session = { user: { id: "safety", email: "safety@example.invalid" } }
  await reviewNciiAction(review)
  assert.deepEqual(calls.at(-1), { fn: "reviewNciiCase", input: { caseId: POST_ID, actorId: "safety", outcome: "valid_remove", rationale: "Valid request" } })
})
