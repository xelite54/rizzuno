import Link from "next/link"
import { severeContentCapability } from "@/lib/imageModeration/severeContent"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { isRateLimited } from "@/lib/apiRateLimit"
import { isAdminEmail } from "@/lib/admin"
import { listReports } from "@/lib/db"
import { resolveReportAction } from "./actions"

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

  return (
    <main className="mx-auto min-h-full w-full max-w-3xl bg-background px-6 py-16 text-foreground">
      <p className="text-sm">Specialist illegal-content detection: {severeContentCapability().state}. Underage concerns require a trained safety reviewer. Follow the operator safety escalation runbook.</p>
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
                <option value="suspend">Suspend</option>
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
                placeholder="reason (required for ban/suspension)"
                className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[13px]"
              />
              <label className="text-[12px]">
                <input type="checkbox" name="confirmEnforcement" value="yes" /> Confirm suspension / permanent ban
              </label>
              <button type="submit" className="rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-semibold text-background">
                Apply
              </button>
            </form>
          </div>
        ))}
      </div>

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
