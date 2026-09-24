import Link from "next/link"
import { severeContentCapability } from "@/lib/imageModeration/severeContent"
import { ageAssuranceCapability } from "@/lib/ageAssurance"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"
import { isAdminEmail } from "@/lib/admin"
import { listAppeals, listReports } from "@/lib/db"
import { resolveAppealAction, resolveReportAction } from "./actions"

export const dynamic = "force-dynamic"

export const metadata = { title: "Moderation — Rizzuno" }

/**
 * Minimal, functional moderation console — not a polished admin dashboard,
 * but every report is now genuinely reachable and actionable rather than
 * sitting in an array "never exposed to clients" (the old, honest comment
 * in server/matchmaker.ts). Returns a plain 404 to anyone who isn't a
 * configured admin, rather than a page that reveals this route exists at
 * all to reach.
 */
export default async function AdminPage() {
  const session = await auth()
  if (!isAdminEmail(session?.user?.email)) {
    notFound()
  }

  if (!session?.user?.id || await isRateLimited(`admin-read:${session.user.id}`, 60, 60_000)) notFound()

  const pending = (await listReports("pending")).filter(report=>report.reported_id!==session.user.id)
  const reviewed = (await listReports("reviewed")).filter(report=>report.reported_id!==session.user.id).slice(0, 20)
  const appeals = (await listAppeals("submitted")).filter(appeal=>appeal.userId!==session.user.id)

  return (
    <main className="mx-auto min-h-full w-full max-w-3xl bg-background px-6 py-16 text-foreground">
      <p className="text-sm">Age assurance: {ageAssuranceCapability().state} (current gate: self-attestation). Specialist illegal-content detection: {severeContentCapability().state}. Underage concerns require a trained safety reviewer. Follow the operator safety escalation runbook.</p>
      <h1 className="text-[24px] font-bold tracking-tight">Moderation queue</h1>
      <p className="mt-1 text-[13px] text-muted">{pending.length} pending report(s).</p>

      <div className="mt-8 space-y-4">
        {pending.length === 0 && <p className="text-[13px] text-muted">Nothing pending.</p>}
        {pending.map((report) => (
          <div key={report.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-[13px] text-muted">
              {new Date(report.created_at).toLocaleString()} · match {report.match_id ?? "—"}
            </div>
            <div className="mt-1 text-[14px]">
              <span className="font-semibold">{report.priority === "urgent" ? "URGENT — " : ""}{report.category}</span> — reporter{" "}
              <code className="text-[12px]">{report.reporter_id}</code> reported{" "}
              <code className="text-[12px]">{report.reported_id}</code>
            </div>
            {report.details && <p className="mt-1 text-[13px] text-muted">&ldquo;{report.details}&rdquo;</p>}

            <Link className="underline text-sm" href={`/admin/safety/${report.id}`}>Restricted safety case and evidence</Link>
            <form action={resolveReportAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="reportId" value={report.id} />
              <select name="action" className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]" defaultValue="no_action">
                <option value="no_action">No action</option>
                <option value="warning">Warning</option>
                <option value="restrict">Temporary restriction pending review</option>
                <option value="suspend">Temporary suspension</option>
                <option value="ban">Permanent ban</option>
              </select>
              <input
                type="number"
                name="suspendDays"
                placeholder="days"
                min={1}
                className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]"
              />
              <input
                type="text"
                name="reason"
                placeholder="reason (required for restriction/suspension/ban)"
                className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]"
              />
              <label className="text-[12px]">
                <input type="checkbox" name="confirmEnforcement" value="yes" /> Confirm serious enforcement
              </label>
              <button type="submit" className="rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-semibold text-background">
                Apply
              </button>
            </form>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-[16px] font-semibold">Appeals</h2>
      <p className="mt-1 text-[13px] text-muted">{appeals.length} submitted appeal(s). User-facing resolutions must not include confidential reports, evidence, reporter identities, or internal notes.</p>
      <div className="mt-3 space-y-4">{appeals.map(appeal=><article key={appeal.id} className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">{appeal.action} · {appeal.category??"account enforcement"}</p>
        <p className="mt-1 text-xs text-muted">Submitted {new Date(appeal.submittedAt).toLocaleString()} by {appeal.userId}</p>
        <p className="mt-2 text-sm">{appeal.reason}</p>
        {appeal.evidenceReference&&<p className="mt-1 text-xs text-muted">User reference: {appeal.evidenceReference}</p>}
        <form action={resolveAppealAction} className="mt-3 grid gap-2">
          <input type="hidden" name="appealId" value={appeal.id}/>
          <select name="outcome" className="rounded-lg border border-border bg-surface-2 p-2 text-sm"><option value="upheld">Uphold</option><option value="overturned">Overturn</option><option value="dismissed">Dismiss as ineligible/duplicate</option></select>
          <textarea name="resolution" required maxLength={2000} placeholder="User-facing resolution; no confidential notes" className="rounded-lg border border-border bg-surface-2 p-2 text-sm"/>
          <label className="text-xs"><input type="checkbox" name="confirmOverturn" value="yes"/> Confirm account-state restoration if overturning</label>
          <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background">Resolve appeal</button>
        </form>
      </article>)}</div>

      <h2 className="mt-10 text-[16px] font-semibold">Recently reviewed</h2>
      <div className="mt-3 space-y-2">
        {reviewed.map((report) => (
          <div key={report.id} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted">
            {new Date(report.created_at).toLocaleString()} · {report.category} · reported {report.reported_id}
          </div>
        ))}
      </div>
    </main>
  )
}
