"use server"
import { auth } from "@/auth"
import { isSafetyReviewer } from "@/lib/admin"
import { isRateLimited } from "@/lib/apiRateLimit"
import { getCyberTiplineCase, getReportEvidence, recordCyberTiplineCase, recordSafetyDecision, setLegalHold } from "@/lib/db"
import { isWireId } from "@/lib/signaling/validation"

async function reviewer() {
  const session = await auth()
  if (!session?.user?.id || !isSafetyReviewer(session.user.email)) throw new Error("Not authorized")
  if (await isRateLimited(`safety:${session.user.id}`, 60, 60_000)) throw new Error("Rate limited")
  return session.user.id
}
export async function viewEvidence(reportId: string) {
  const actor = await reviewer()
  if (!isWireId(reportId)) throw new Error("Invalid report")
  return getReportEvidence(reportId, actor)
}
export async function safetyDecision(input: { reportId: string; decision: string; caseReference: string; rationale: string; externalReference?: string }) {
  const actorId = await reviewer()
  if (!input || !isWireId(input.reportId) || !["investigation_open", "under13_review_opened", "under13_privacy_review_referred", "under13_not_confirmed", "under13_account_removed", "emergency_escalation", "external_report_required", "external_report_submitted", "external_report_not_required", "investigation_closed"].includes(input.decision) || !/^[A-Za-z0-9_-]{6,80}$/.test(input.caseReference) || !input.rationale?.trim() || input.rationale.length > 2000 || (input.externalReference?.length ?? 0) > 200) throw new Error("Invalid safety decision")
  await recordSafetyDecision({ ...input, actorId })
}
export async function legalHold(input: { caseReference: string; reason: string; releaseId?: string }) {
  const actorId = await reviewer()
  if (!input || !/^[A-Za-z0-9_-]{6,80}$/.test(input.caseReference) || !input.reason?.trim() || input.reason.length > 2000 || (input.releaseId && !isWireId(input.releaseId))) throw new Error("Invalid hold")
  return setLegalHold(actorId, input.caseReference, input.reason, input.releaseId)
}
export async function viewCyberTiplineCase(reportId: string) {
  const actor = await reviewer()
  if (!isWireId(reportId)) throw new Error("Invalid report")
  return getCyberTiplineCase(reportId, actor)
}
export async function cyberTiplineDecision(input: { reportId:string; decision:string; caseReference:string; rationale:string; submittedAt?:string; receiptReference?:string; preservationExpiresAt?:string }) {
  const actorId=await reviewer()
  if(!input||!isWireId(input.reportId)||!["not_required","manual_report_required","manual_report_submitted"].includes(input.decision)||!/^[A-Za-z0-9_-]{6,80}$/.test(input.caseReference)||!input.rationale?.trim()||input.rationale.length>2000)throw new Error("Invalid CyberTipline case")
  const parse=(value?:string)=>value?.trim()?Date.parse(value):undefined
  for(const value of [input.submittedAt,input.preservationExpiresAt])if(value?.trim()&&!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim()))throw new Error("CyberTipline timestamps require an explicit timezone")
  const submittedAt=parse(input.submittedAt); const preservationExpiresAt=parse(input.preservationExpiresAt)
  if((submittedAt!==undefined&&!Number.isFinite(submittedAt))||(preservationExpiresAt!==undefined&&!Number.isFinite(preservationExpiresAt)))throw new Error("Invalid CyberTipline timestamp")
  await recordCyberTiplineCase({reportId:input.reportId,actorId,caseReference:input.caseReference,decision:input.decision as "not_required"|"manual_report_required"|"manual_report_submitted",rationale:input.rationale,submittedAt,receiptReference:input.receiptReference,preservationExpiresAt})
}
