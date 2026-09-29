import { log } from "./observability"

/**
 * Server-only staff alerts for new reports and NCII cases. Destinations come
 * exclusively from the server environment — never from code or the client:
 *   SAFETY_NOTICE_EMAIL  new moderation reports
 *   NCII_NOTICE_EMAIL    new NCII removal requests (falls back to SAFETY_NOTICE_EMAIL)
 * Delivery uses Resend's HTTP API (RESEND_API_KEY, NOTIFICATION_FROM_EMAIL).
 * Unconfigured → skipped. A failed alert never fails or delays the report.
 *
 * Alerts are deliberately minimal: a case/report reference, category, target
 * type, priority and a link to the restricted admin page. Never reporter or
 * requester identity, account ids, details, evidence, images or hashes —
 * email is not a restricted evidence store.
 */
type Notice = { kind: "report"; reportId: string; category: string; targetType: string; priority: string }
  | { kind: "ncii"; caseId: string; targetType: string; removalDueAt: number }

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export function noticeDestination(kind: Notice["kind"], env: Record<string, string | undefined> = process.env): string | null {
  const value = (kind === "ncii" ? env.NCII_NOTICE_EMAIL?.trim() || env.SAFETY_NOTICE_EMAIL : env.SAFETY_NOTICE_EMAIL)?.trim()
  return value && EMAIL.test(value) ? value : null
}

export function noticeMessage(notice: Notice, appUrl = process.env.APP_URL ?? ""): { subject: string; text: string } {
  const base = appUrl.replace(/\/+$/, "")
  if (notice.kind === "ncii") {
    return {
      subject: "[Rizzuno] New NCII removal request",
      text: `A new intimate-image (NCII) removal request needs validity review.\n\nCase: ${notice.caseId}\nTarget: ${notice.targetType}\nReview due: ${new Date(notice.removalDueAt).toISOString()}\n\nOpen the restricted case (safety reviewers only): ${base}/admin/ncii/${notice.caseId}\n\nDo not forward this email or copy case details into ordinary tickets.`,
    }
  }
  return {
    subject: `[Rizzuno] ${notice.priority === "urgent" ? "URGENT " : ""}new report: ${notice.category}`,
    text: `A new report is waiting in the moderation queue.\n\nReport: ${notice.reportId}\nCategory: ${notice.category}\nTarget: ${notice.targetType}\nPriority: ${notice.priority}\n\nModeration queue: ${base}/admin`,
  }
}

export async function notifySafetyTeam(notice: Notice, env: Record<string, string | undefined> = process.env): Promise<void> {
  const to = noticeDestination(notice.kind, env)
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.NOTIFICATION_FROM_EMAIL?.trim()
  if (!to) return
  if (!apiKey || !from) { log.warn("safety.notice_unconfigured", { kind: notice.kind }); return }
  const { subject, text } = noticeMessage(notice, env.APP_URL)
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
  } catch {
    log.error("safety.notice_failed", { kind: notice.kind })
  }
}
