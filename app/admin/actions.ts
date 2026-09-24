"use server"

import { auth } from "@/auth"
import { isAdminEmail, isSafetyReviewer } from "@/lib/admin"
import { getAppealForAdmin, getReport, resolveAppeal, resolveReport, type ModerationAction } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { revalidatePath } from "next/cache"

const VALID_ACTIONS: ModerationAction[] = ["no_action", "warning", "restrict", "suspend", "ban"]

/**
 * Every actual enforcement decision funnels through here. Re-checks admin
 * authorization itself rather than trusting that only the admin page could
 * have called it — a Server Action is a real network-reachable endpoint,
 * not a private function, so it has to defend itself the same as any API
 * route would.
 */
export async function resolveReportAction(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    throw new Error("Not authorized")
  }
  if (await isRateLimited(`admin-resolve:${session!.user!.id}`, 60, 60_000)) {
    throw new Error("Rate limited")
  }

  const reportId = String(formData.get("reportId") ?? "")
  const actionRaw = String(formData.get("action") ?? "")
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null
  const suspendDays = Number(formData.get("suspendDays") ?? 0)

  if (!/^[0-9a-f-]{36}$/i.test(reportId) || !VALID_ACTIONS.includes(actionRaw as ModerationAction)) {
    throw new Error("Invalid input")
  }
  const action = actionRaw as ModerationAction
  if (["restrict", "suspend", "ban"].includes(action) && (!reason || formData.get("confirmEnforcement") !== "yes")) throw new Error("Reason and confirmation required")

  const suspendUntil =
    ["restrict", "suspend"].includes(action) && Number.isInteger(suspendDays) && suspendDays > 0 && suspendDays <= 365 ? Date.now() + suspendDays * 24 * 60 * 60 * 1000 : null
  if (["restrict", "suspend"].includes(action) && !suspendUntil) {
    throw new Error("Temporary enforcement requires a positive number of days")
  }

  const report = await getReport(reportId)
  if (report?.priority === "urgent" && !isSafetyReviewer(session.user.email)) throw new Error("Trained safety reviewer required")
  await resolveReport(reportId, session!.user!.id, action, reason, suspendUntil)
  revalidatePath("/admin")
}

export async function resolveAppealAction(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id || !isAdminEmail(session.user.email)) throw new Error("Not authorized")
  if (await isRateLimited(`admin-appeal:${session.user.id}`, 30, 60_000)) throw new Error("Rate limited")

  const appealId = String(formData.get("appealId") ?? "")
  const outcome = String(formData.get("outcome") ?? "") as "upheld" | "overturned" | "dismissed"
  const resolution = String(formData.get("resolution") ?? "").trim()
  if (
    !/^[0-9a-f-]{36}$/i.test(appealId) ||
    !["upheld", "overturned", "dismissed"].includes(outcome) ||
    !resolution ||
    resolution.length > 2000
  ) throw new Error("Invalid appeal resolution")
  if (outcome === "overturned" && formData.get("confirmOverturn") !== "yes") throw new Error("Confirm overturn")

  const appeal = await getAppealForAdmin(appealId)
  if (!appeal || appeal.userId === session.user.id) throw new Error("Appeal unavailable")
  if (appeal.category === "underage_concern" && !isSafetyReviewer(session.user.email)) {
    throw new Error("Trained safety reviewer required")
  }
  await resolveAppeal({ appealId, actorAdminId: session.user.id, outcome, resolution })
  revalidatePath("/admin")
}
