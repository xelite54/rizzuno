import { auth } from "@/auth"
import { isSafetyReviewer } from "@/lib/admin"
import { notFound } from "next/navigation"
import { getReport } from "@/lib/db"
import { viewCyberTiplineCase, viewEvidence, safetyDecision, legalHold, cyberTiplineDecision } from "../actions"
import { resolveReportAction } from "../../actions"

export const dynamic = "force-dynamic"
export default async function SafetyCase({ params }: { params: Promise<{ reportId: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !isSafetyReviewer(session.user.email)) notFound()
  const { reportId } = await params
  const [evidence, cyberTiplineCase] = await Promise.all([viewEvidence(reportId),viewCyberTiplineCase(reportId)])
  const report = await getReport(reportId)
  if (!report || report.reported_id === session.user.id) notFound()
  async function decision(form: FormData) {
    "use server"
    await safetyDecision({ reportId, decision: String(form.get("decision")), caseReference: String(form.get("caseReference")), rationale: String(form.get("rationale")), externalReference: String(form.get("externalReference") ?? "") })
  }
  async function hold(form: FormData) {
    "use server"
    await legalHold({ caseReference: String(form.get("caseReference")), reason: String(form.get("reason")), releaseId: String(form.get("releaseId") ?? "") || undefined })
  }
  async function cybertip(form: FormData) {
    "use server"
    await cyberTiplineDecision({reportId,decision:String(form.get("decision")),caseReference:String(form.get("caseReference")),rationale:String(form.get("rationale")),submittedAt:String(form.get("submittedAt")??"")||undefined,receiptReference:String(form.get("receiptReference")??"")||undefined,preservationExpiresAt:String(form.get("preservationExpiresAt")??"")||undefined})
  }
  return <main className="h-dvh overflow-y-auto px-6 py-10"><div className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">Restricted safety case</h1>
    <p>Report {reportId} · {report.category} · Investigation {report.safety_state}. This view is audited. Do not copy evidence into ordinary tickets or email. Follow docs/SAFETY_ESCALATION.md.</p>
    <pre className="overflow-x-auto whitespace-pre-wrap rounded border p-4 text-xs">{JSON.stringify(evidence, null, 2)}</pre>
    <form action={cybertip} className="grid gap-3 rounded border border-border p-4">
      <h2 className="font-semibold">U.S. CyberTipline decision and preservation</h2>
      <p className="text-sm">Authorized staff record a reviewed manual decision here. An ordinary underage report does not create this case or trigger NCMEC. Rizzuno never submits automatically. Do not upload call video, screenshots, or create new evidence for this form.</p>
      {cyberTiplineCase && <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(cyberTiplineCase,null,2)}</pre>}
      <label>Case reference <input name="caseReference" defaultValue={cyberTiplineCase?.caseReference} required pattern="[A-Za-z0-9_-]{6,80}" className="border" /></label>
      <label>Manual decision <select name="decision" defaultValue={cyberTiplineCase?.decision} className="border"><option value="not_required">Operator recorded: not required</option><option value="manual_report_required">Operator recorded: manual report required</option><option value="manual_report_submitted">Operator recorded: manually submitted</option></select></label>
      <label>Decision rationale <textarea name="rationale" defaultValue={cyberTiplineCase?.rationale} required maxLength={2000} className="border" /></label>
      <label>Submission timestamp (RFC 3339/ISO with timezone; submitted only) <input name="submittedAt" defaultValue={cyberTiplineCase?.submittedAt ? new Date(cyberTiplineCase.submittedAt).toISOString() : ""} placeholder="2026-09-25T18:00:00Z" className="border" /></label>
      <label>CyberTipline receipt/reference (submitted only) <input name="receiptReference" defaultValue={cyberTiplineCase?.receiptReference ?? ""} maxLength={500} className="border" /></label>
      <label>Preservation expiration (RFC 3339/ISO with timezone; at least one year after submission) <input name="preservationExpiresAt" defaultValue={cyberTiplineCase?.preservationExpiresAt ? new Date(cyberTiplineCase.preservationExpiresAt).toISOString() : ""} placeholder="2027-09-25T18:00:00Z" className="border" /></label>
      <button className="rounded border p-2">Record manual decision</button>
    </form>
    <form action={decision} className="grid gap-3">
      <h2 className="font-semibold">Decision log</h2>
      <p className="text-sm">For a possible under-13 account, open the dedicated review and refer it to the approved privacy/safety process. These entries document review; use the enforcement control for an actual restriction or removal. They do not make a legal determination or contact an external organization.</p>
      <label>Case reference <input name="caseReference" required pattern="[A-Za-z0-9_-]{6,80}" className="border" /></label>
      <label>Decision <select name="decision" className="border">{["investigation_open", "under13_review_opened", "under13_privacy_review_referred", "under13_not_confirmed", "under13_account_removed", "emergency_escalation", "external_report_required", "external_report_submitted", "external_report_not_required", "investigation_closed"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Rationale <textarea name="rationale" required maxLength={2000} className="border" /></label>
      <label>External receipt/reference <input name="externalReference" maxLength={200} className="border" /></label>
      <button className="rounded border p-2">Record decision</button>
    </form>
    {report.status === "pending" && <form action={resolveReportAction} className="grid gap-3">
      <h2 className="font-semibold">Temporary restriction during investigation</h2>
      <input type="hidden" name="reportId" value={reportId} /><input type="hidden" name="action" value="restrict" />
      <label>Days <input name="suspendDays" type="number" min={1} max={365} required className="border" /></label>
      <label>Reason <textarea name="reason" required maxLength={500} className="border" /></label>
      <label><input type="checkbox" name="confirmEnforcement" value="yes" required /> Confirm temporary restriction</label>
      <button className="rounded border p-2">Temporarily restrict; keep investigation open</button>
    </form>}
    <form action={hold} className="grid gap-3">
      <h2 className="font-semibold">Preservation hold</h2>
      <p>A hold conservatively pauses all retention purges and erasures; user changes preserve restricted pre-change records. Release only with documented legal approval.</p>
      <label>Case reference <input name="caseReference" required pattern="[A-Za-z0-9_-]{6,80}" className="border" /></label>
      <label>Reason <textarea name="reason" required maxLength={2000} className="border" /></label>
      <label>Hold ID to release (leave blank to create) <input name="releaseId" className="border" /></label>
      <button className="rounded border p-2">Record hold decision</button>
    </form>
  </div></main>
}
