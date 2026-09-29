import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { isSafetyReviewer } from "@/lib/admin"
import { isRateLimited } from "@/lib/apiRateLimit"
import { getNciiCase } from "@/lib/db"
import { TARGET_LABELS } from "@/lib/reportTargets"
import { reviewNciiAction } from "../../actions"

export const dynamic = "force-dynamic"

/**
 * Restricted NCII case: trained safety reviewers only, audited on every view
 * (lib/db.ts getNciiCase). Tracked separately from the ordinary moderation
 * queue; the linked report there only carries account-enforcement decisions.
 */
export default async function NciiCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !isSafetyReviewer(session.user.email)) notFound()
  if (await isRateLimited(`safety:${session.user.id}`, 60, 60_000)) notFound()
  const { caseId } = await params
  const nciiCase = await getNciiCase(caseId, session.user.id)
  if (!nciiCase) notFound()
  const open = nciiCase.status === "received"

  return <main className="h-dvh overflow-y-auto px-6 py-10"><div className="mx-auto max-w-3xl space-y-6">
    <Link href="/admin" className="text-sm underline">Back to moderation</Link>
    <h1 className="text-2xl font-bold">NCII removal request</h1>
    <p className="text-sm">Restricted and audited. Do not copy the image, requester details or this case into ordinary tickets or email. Follow docs/SAFETY_ESCALATION.md.</p>
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">Status</dt><dd>{nciiCase.status}</dd>
      <dt className="text-muted">Received</dt><dd>{new Date(nciiCase.receivedAt).toLocaleString()}</dd>
      <dt className="text-muted">Review due</dt><dd className={nciiCase.overdue ? "font-semibold text-danger" : ""}>{new Date(nciiCase.removalDueAt).toLocaleString()}</dd>
      <dt className="text-muted">Target</dt><dd>{TARGET_LABELS[nciiCase.targetType]} · {nciiCase.targetId}</dd>
      <dt className="text-muted">Reported user</dt><dd>@{nciiCase.reportedUsername ?? "unknown"} <code className="text-xs">{nciiCase.reportedUserId}</code></dd>
      <dt className="text-muted">Content reference</dt><dd><code className="text-xs">{nciiCase.contentReference ?? "—"}</code></dd>
      <dt className="text-muted">Image SHA-256</dt><dd><code className="break-all text-xs">{nciiCase.imageSha256 ?? "not available"}</code></dd>
      <dt className="text-muted">Requester</dt><dd>{nciiCase.relationship === "depicted_person" ? "Person shown" : "Authorized representative"} · <code className="text-xs">{nciiCase.requesterUserId}</code></dd>
      <dt className="text-muted">Signature</dt><dd>{nciiCase.signatureName}</dd>
      <dt className="text-muted">Contact</dt><dd>{nciiCase.contact}</dd>
      <dt className="text-muted">Good-faith statement</dt><dd>Affirmed</dd>
      <dt className="text-muted">Description</dt><dd className="whitespace-pre-wrap">{nciiCase.description ?? "—"}</dd>
      {!open && <><dt className="text-muted">Decision</dt><dd>{nciiCase.decisionRationale} ({nciiCase.decidedAt ? new Date(nciiCase.decidedAt).toLocaleString() : ""})</dd></>}
    </dl>
    {nciiCase.postImage
      // eslint-disable-next-line @next/next/no-img-element -- restricted reviewer view of the still-existing identified post
      ? <details><summary className="cursor-pointer text-sm underline">Show identified post (sensitive)</summary><img src={nciiCase.postImage} alt="Identified post" className="mt-2 max-h-96 rounded border border-border" /></details>
      : <p className="text-sm text-muted">The identified post is no longer available.</p>}
    {open && <form action={reviewNciiAction} className="grid gap-3 rounded border border-border p-4">
      <h2 className="font-semibold">Validity review</h2>
      <p className="text-sm">A valid request for a post removes that post through the audited content-removal path (Storage deletion is queued and paused by any active legal hold). Account enforcement is a separate decision on the linked report in the moderation queue.</p>
      <input type="hidden" name="caseId" value={nciiCase.id} />
      <label className="grid gap-1 text-sm">Outcome <select name="outcome" className="border" defaultValue={nciiCase.targetType === "post" && nciiCase.postImage ? "valid_remove" : "valid_unavailable"}>
        {nciiCase.targetType === "post" && nciiCase.postImage && <option value="valid_remove">Valid — remove the identified post</option>}
        <option value="valid_unavailable">Valid — content already unavailable / not removable in-app</option>
        <option value="rejected">Invalid or insufficient request</option>
      </select></label>
      <label className="grid gap-1 text-sm">Rationale <textarea name="rationale" required maxLength={2000} className="border" /></label>
      <label className="text-sm"><input type="checkbox" name="confirmReview" value="yes" required /> Confirm review decision</label>
      <button className="rounded border p-2">Record decision</button>
    </form>}
  </div></main>
}
