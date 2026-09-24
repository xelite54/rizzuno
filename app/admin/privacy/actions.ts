"use server"

import { auth } from "@/auth"
import { isAdminEmail } from "@/lib/admin"
import { isRateLimited } from "@/lib/apiRateLimit"
import { exportUserData, eraseUserData } from "@/lib/db"
import { isWireId } from "@/lib/signaling/validation"

/** Operator-only: caller must have independently verified the contact request. */
export async function processPrivacyRequest(input: { userId: string; action: "export" | "erase"; caseReference: string; identityVerified: boolean; retentionReviewed: boolean }) {
  const session = await auth()
  if (!session?.user?.id || !isAdminEmail(session.user.email)) throw new Error("Not authorized")
  if (!input || !isWireId(input.userId) || !["export", "erase"].includes(input.action)
    || input.identityVerified !== true || input.retentionReviewed !== true
    || typeof input.caseReference !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(input.caseReference)) throw new Error("Invalid privacy request")
  if (await isRateLimited(`privacy:${session.user.id}`, 10, 3_600_000)) throw new Error("Rate limited")
  if (input.action === "export") return exportUserData(input.userId, session.user.id, input.caseReference)
  const result = await eraseUserData(input.userId, session.user.id, input.caseReference)
  return { erased: result.storagePending === 0, ...result }
}
