"use server"

import { auth } from "@/auth"
import { isAdminEmail } from "@/lib/admin"
import { resolveReport, type ModerationAction } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { revalidatePath } from "next/cache"

const VALID_ACTIONS: ModerationAction[] = ["no_action", "warning", "suspend", "ban"]

/**
 * Every actual enforcement decision funnels through here. Re-checks admin
 * authorization itself rather than trusting that only the admin page could
 * have called it — a Server Action is a real network-reachable endpoint,
 * not a private function, so it has to defend itself the same as any API
 * route would.
 */
export async function resolveReportAction(formData: FormData) {
  const session = await auth()
  if (!isAdminEmail(session?.user?.email)) {
    throw new Error("Not authorized")
  }
  if (isRateLimited(`admin-resolve:${session!.user!.id}`, 60, 60_000)) {
    throw new Error("Rate limited")
  }

  const reportId = String(formData.get("reportId") ?? "")
  const actionRaw = String(formData.get("action") ?? "")
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null
  const suspendDays = Number(formData.get("suspendDays") ?? 0)

  if (!reportId || !VALID_ACTIONS.includes(actionRaw as ModerationAction)) {
    throw new Error("Invalid input")
  }
  const action = actionRaw as ModerationAction

  const suspendUntil =
    action === "suspend" && suspendDays > 0 ? Date.now() + suspendDays * 24 * 60 * 60 * 1000 : null
  if (action === "suspend" && !suspendUntil) {
    throw new Error("Suspend requires a positive number of days")
  }

  await resolveReport(reportId, session!.user!.id, action, reason, suspendUntil)
  revalidatePath("/admin")
}
