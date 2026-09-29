import Link from "next/link"
import { severeContentCapability } from "@/lib/imageModeration/severeContent"
import { ageAssuranceCapability } from "@/lib/ageAssurance"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"
import { isAdminEmail, isSafetyReviewer } from "@/lib/admin"
import { listAppeals, listNciiCases, listReports, type ReportQueueRow } from "@/lib/db"
import { NCII_REPORT_CATEGORY, TARGET_LABELS } from "@/lib/reportTargets"
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
  const safetyReviewer = isSafetyReviewer(session.user.email)
  const nciiCases = safetyReviewer ? await listNciiCases(session.user.id, "open") : []

  return (
    <main className="mx-auto min-h-full w-full max-w-3xl bg-background px-6 py-16 text-foreground">
      <p className="text-sm">Age assurance: {ageAssuranceCapability().state} (current gate: self-attestation). Specialist illegal-content detection: {severeContentCapability().state}. Underage concerns require a trained safety reviewer. Follow the operator safety escalation runbook.</p>
      <h1 className="text-[24px] font-bold tracking-tight">Moderation queue</h1>
      <p className="mt-1 text-[13px] text-muted">{pending.length} pending report(s). Content decisions (keep/remove the reported post) and account decisions are separate; removing content never applies an account penalty by itself.</p>

      {safetyReviewer && (
        <section className="mt-8">
          <h2 className="text-[16px] font-semibold">NCII removal requests</h2>
          <p className="mt-1 text-[13px] text-muted">{nciiCases.length} open request(s), separate from ordinary reports. Review validity and decide removal on the restricted case page; views are audited.</p>
          <div className="mt-3 space-y-2">
            {nciiCases.map((nciiCase) => (
              <Link key={nciiCase.id} href={`/admin/ncii/${nciiCase.id}`} className="block rounded-lg border border-border px-3 py-2 text-[13px] hover:bg-surface-2">
                <span className={nciiCase.overdue ? "font-semibold text-danger" : "font-semibold"}>Due {new Date(nciiCase.removalDueAt).toLocaleString()}</span>
                {" · "}{TARGET_LABELS[nciiCase.targetType]} · @{nciiCase.reportedUsername ?? "unknown"} · received {new Date(nciiCase.receivedAt).toLocaleString()}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 space-y-4">
        {pending.length === 0 && <p className="text-[13px] text-muted">Nothing pending.</p>}
        {pending.map((report) => (
          <div key={report.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">{TARGET_LABELS[report.target_type]}</span>
              {report.category === NCII_REPORT_CATEGORY && <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">NCII legal case</span>}
              <span>Submitted {new Date(report.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-1 text-[14px]">
              <span className="font-semibold">{report.priority === "urgent" ? "URGENT — " : ""}{report.category}</span> — reported user{" "}
              <span className="font-semibold">@{report.reported_username ?? "unknown"}</span> <code className="text-[12px]">{report.reported_id}</code>
            </div>
            <div className="mt-1 text-[13px]">Target: {targetSummary(report)}</div>
            <div className="text-[12px] text-muted">Reporter <code>{report.reporter_id}</code> · Previous reports {report.prior_reports} · Previous enforcement {report.prior_actions} · Previous content removals {report.prior_removals}</div>
            {report.details && <p className="mt-1 text-[13px] text-muted">&ldquo;{report.details}&rdquo;</p>}
            {report.target_type === "post" && ["underage_concern", NCII_REPORT_CATEGORY].includes(report.category)
              ? <p className="mt-2 text-[12px] text-muted">Preview withheld from the general queue for this category; follow the restricted safety workflow.</p>
              : report.target_type === "post" && (report.target_available && report.post_image
              // eslint-disable-next-line @next/next/no-img-element -- restricted admin preview of the still-existing reported post
              ? <img src={report.post_image} alt="Reported post" className="mt-2 h-40 w-40 rounded-lg border border-border object-cover" />
              : <p className="mt-2 text-[12px] text-muted">Post no longer available{report.content_reference ? ` (reference at report time: ${report.content_reference})` : ""}.</p>)}
            {report.ncii_case_id && safetyReviewer && <Link className="mt-1 block text-sm underline" href={`/admin/ncii/${report.ncii_case_id}`}>Open NCII case (removal is decided there)</Link>}

            <Link className="underline text-sm" href={`/admin/safety/${report.id}`}>Restricted safety case and evidence</Link>
            <form action={resolveReportAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="reportId" value={report.id} />
              {report.target_type === "post" && report.target_available && report.category !== NCII_REPORT_CATEGORY && (
                <select name="contentAction" aria-label="Content action" className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]" defaultValue="keep">
                  <option value="keep">Keep post</option>
                  <option value="remove">Remove post</option>
                </select>
              )}
              <select name="action" aria-label="Account action" className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]" defaultValue="no_action">
                <option value="no_action">No account action</option>
                <option value="warning">Warn user</option>
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
            {new Date(report.created_at).toLocaleString()} · {TARGET_LABELS[report.target_type]} · {report.category} · reported @{report.reported_username ?? report.reported_id}
          </div>
        ))}
      </div>
    </main>
  )
}

function targetSummary(report: ReportQueueRow): string {
  const who = `@${report.reported_username ?? "unknown"}`
  switch (report.target_type) {
    case "post": return `Post · ${who} · post ${report.target_id.slice(0, 8)}`
    case "match": return `Match · room/session ${report.target_id}`
    case "message": return `Message · ${who} · message ${report.target_id.slice(0, 8)}${report.content_reference ? ` (${report.content_reference})` : ""}`
    default: return `User · ${who}`
  }
}
