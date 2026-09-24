import { auth } from "@/auth"
import { isSafetyReviewer } from "@/lib/admin"
import { notFound } from "next/navigation"
import { getReport } from "@/lib/db"
import { viewEvidence, safetyDecision, legalHold } from "../actions"
import { resolveReportAction } from "../../actions"

export const dynamic = "force-dynamic"
export default async function SafetyCase({ params }: { params: Promise<{ reportId: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !isSafetyReviewer(session.user.email)) notFound()
  const { reportId } = await params
  const evidence = await viewEvidence(reportId)
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
  return <main className="h-dvh overflow-y-auto px-6 py-10"><div className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">Restricted safety case</h1>
    <p>Report {reportId} · {report.category} · Investigation {report.safety_state}. This view is audited. Do not copy evidence into ordinary tickets or email. Follow docs/SAFETY_ESCALATION.md.</p>
    <pre className="overflow-x-auto whitespace-pre-wrap rounded border p-4 text-xs">{JSON.stringify(evidence, null, 2)}</pre>
    <form action={decision} className="grid gap-3">
      <h2 className="font-semibold">Decision log</h2>
      <label>Case reference <input name="caseReference" required pattern="[A-Za-z0-9_-]{6,80}" className="border" /></label>
      <label>Decision <select name="decision" className="border">{["investigation_open", "emergency_escalation", "external_report_required", "external_report_submitted", "external_report_not_required", "investigation_closed"].map(value => <option key={value}>{value}</option>)}</select></label>
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
