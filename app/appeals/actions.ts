"use server"

import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"
import { submitAppeal } from "@/lib/db"
import { isWireId } from "@/lib/signaling/validation"
import { redirect } from "next/navigation"

export async function submitAppealAction(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not authenticated")
  if (await isRateLimited(`appeal:${session.user.id}`, 5, 3_600_000)) throw new Error("Rate limited")

  const enforcementId = String(formData.get("enforcementId") ?? "")
  const reason = String(formData.get("reason") ?? "").trim()
  const evidenceReference = String(formData.get("evidenceReference") ?? "").trim()
  if (!isWireId(enforcementId) || !reason || reason.length > 2000 || evidenceReference.length > 500) {
    throw new Error("Invalid appeal")
  }
  await submitAppeal({
    userId: session.user.id,
    enforcementId,
    reason,
    evidenceReference: evidenceReference || undefined,
  })
  redirect("/appeals?submitted=1")
}
