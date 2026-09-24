"use server"

import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"
import { fileRecentMatchReport } from "@/lib/db"
import { isValidReportCategory } from "@/lib/signaling/protocol"
import { isWireId } from "@/lib/signaling/validation"
import { sanitizeText } from "@/lib/textFilter"
import { redirect } from "next/navigation"

export async function reportRecentMatch(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not authenticated")
  if (await isRateLimited(`recent-report:${session.user.id}`, 10, 60_000)) throw new Error("Rate limited")
  const matchId = String(formData.get("matchId") ?? "")
  const category = String(formData.get("category") ?? "")
  const details = sanitizeText(formData.get("details"), 500)
  if (!isWireId(matchId) || !isValidReportCategory(category)) throw new Error("Invalid report")
  try {
    await fileRecentMatchReport({ reporterId: session.user.id, matchId, category, details: details || undefined })
  } catch (error) {
    if (error instanceof Error && error.message === "match_not_reportable") redirect("/reports/recent?error=unavailable")
    throw error
  }
  redirect("/reports/recent?submitted=1")
}
