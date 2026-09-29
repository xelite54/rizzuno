"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { CheckIcon, CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"
import type { ReportCategory } from "@/lib/signaling/protocol"
import { REPORT_REASONS, reportHeading, type NciiRelationship, type ReportTargetRef } from "@/lib/reportTargets"

type ReportDialogProps = {
  open: boolean
  /** Only the target's own opaque reference (a username for `user`). The server resolves who is responsible. */
  target: ReportTargetRef
  onClose: () => void
  /**
   * Sends an ordinary report through a context-specific transport that adds
   * server-side context (the live call's room and recent chat, a friend's
   * socket path). Omitted → POST /api/reports. The NCII branch always uses
   * its own intake endpoint.
   */
  submitOrdinary?: (category: ReportCategory, details?: string) => Promise<void> | void
}

type View = { kind: "reasons" } | { kind: "details"; category: ReportCategory; label: string } | { kind: "ncii" } | { kind: "done"; message: string }

const ERRORS: Record<string, string> = {
  content_unavailable: "This is no longer available to report.",
  rate_limited: "Too many reports. Wait a minute and try again.",
  description_required: "Describe the image and where you saw it.",
  not_authenticated: "Sign in again to report.",
}

/** The default ordinary-report transport: POST /api/reports with only the target reference. */
export function sendReport(target: ReportTargetRef, category: ReportCategory, details?: string) {
  return post("/api/reports", { targetType: target.type, targetId: target.id, category, details })
}

/** Live-call report transport: the socket path (room + recent chat) while
 * still in that room, else the ended match through the server ledger. */
export function reportMatch(roomId: string, reportLive: (category: ReportCategory, details: string | undefined, expectedRoomId: string) => boolean) {
  return async (category: ReportCategory, details?: string) => {
    if (!reportLive(category, details, roomId)) await sendReport({ type: "match", id: roomId }, category, details)
  }
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(ERRORS[data.error ?? ""] ?? "Couldn’t send the report. Please try again.")
  }
}

/**
 * THE Report UI for every target — a post, a profile, a live or recent call,
 * a friend's profile. One reason list; ordinary reasons go to the unified
 * reports queue, while "Intimate image shared without consent" branches into
 * the dedicated NCII intake instead of filing an ordinary report.
 */
export function ReportDialog({ open, target, onClose, submitOrdinary }: ReportDialogProps) {
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after hydration
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {open && <DialogBody key={`${target.type}:${target.id}`} target={target} onClose={onClose} submitOrdinary={submitOrdinary} />}
    </AnimatePresence>,
    document.body,
  )
}

function DialogBody({ target, onClose, submitOrdinary }: Omit<ReportDialogProps, "open">) {
  const [view, setView] = useState<View>({ kind: "reasons" })
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relationship, setRelationship] = useState<NciiRelationship | null>(null)
  const [goodFaith, setGoodFaith] = useState(false)
  const [signatureName, setSignatureName] = useState("")
  const [contact, setContact] = useState("")
  const [description, setDescription] = useState("")
  const panelRef = useRef<HTMLDivElement>(null)
  const heading = view.kind === "ncii" ? "Intimate image shared without consent" : reportHeading(target.type)

  useEffect(() => { panelRef.current?.querySelector<HTMLElement>("button, textarea, input")?.focus() }, [view.kind])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  async function run(action: () => Promise<void> | void, message: string) {
    setBusy(true); setError(null)
    try { await action(); setView({ kind: "done", message }) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  function submitReport(category: ReportCategory) {
    const trimmed = details.trim() || undefined
    void run(() => submitOrdinary
      ? submitOrdinary(category, trimmed)
      : sendReport(target, category, trimmed), "Report submitted.")
  }

  function submitNcii(event: React.FormEvent) {
    event.preventDefault()
    if (!relationship || !goodFaith || signatureName.trim().length < 2) { setError("Complete the required fields."); return }
    if (target.type !== "post" && !description.trim()) { setError(ERRORS.description_required); return }
    void run(() => post("/api/reports/ncii", { targetType: target.type, targetId: target.id, relationship, goodFaith, signatureName,
      contact: contact.trim() || undefined, description: description.trim() || undefined }),
    "Request received. It goes to our dedicated removal review, separate from ordinary reports.")
  }

  const button = "w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground transition hover:bg-surface-2 disabled:opacity-50"
  const field = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        data-report-dialog={target.type}
        initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
        transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-surface p-4 text-left shadow-xl"
      >
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-foreground">{heading}</h2>
          <button type="button" onClick={onClose} aria-label="Close report" className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {view.kind === "reasons" && (
          <div className="flex flex-col">
            <p className="mb-1 px-1 text-[12px] text-muted">Why are you reporting this?</p>
            {REPORT_REASONS.map((reason) => (
              <button key={reason.value} type="button" className={button}
                onClick={() => { setError(null); setView(reason.branch === "ncii" ? { kind: "ncii" } : { kind: "details", category: reason.value, label: reason.label }) }}>
                {reason.label}
              </button>
            ))}
          </div>
        )}

        {view.kind === "details" && (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[13px] text-foreground">{view.label}</p>
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={500} rows={3} placeholder="Add details (optional)" className={field} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setView({ kind: "reasons" })} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">Back</button>
              <button type="button" disabled={busy} onClick={() => submitReport(view.category)} className="flex-1 rounded-lg bg-danger py-2 text-[13px] font-medium text-accent-foreground transition hover:brightness-110 disabled:opacity-60">Submit report</button>
            </div>
          </div>
        )}

        {view.kind === "ncii" && (
          <form onSubmit={submitNcii} className="flex flex-col gap-3 text-[13px] text-foreground">
            <p className="text-[12px] leading-snug text-muted">
              This goes to a dedicated removal review, not the ordinary report queue. Staff check that the request is complete and valid before removing anything. Don&apos;t attach or re-send the image.
            </p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[12px] text-muted">Who is making this request?</legend>
              <label className="flex items-center gap-2"><input type="radio" name="relationship" checked={relationship === "depicted_person"} onChange={() => setRelationship("depicted_person")} /> I am the person shown</label>
              <label className="flex items-center gap-2"><input type="radio" name="relationship" checked={relationship === "authorized_representative"} onChange={() => setRelationship("authorized_representative")} /> I am authorized to act for them</label>
            </fieldset>
            {target.type !== "post" && (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-muted">Identify the image (where you saw it, what it shows)</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} required className={field} />
              </label>
            )}
            {target.type === "post" && (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-muted">Anything else we should know (optional)</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} className={field} />
              </label>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} className="mt-0.5" />
              <span>I believe in good faith that this intimate image was shared without the consent of the person shown.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Full name (your signature)</span>
              <input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} maxLength={200} required autoComplete="name" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Contact email (optional — defaults to your sign-in email)</span>
              <input type="email" value={contact} onChange={(event) => setContact(event.target.value)} maxLength={320} autoComplete="email" className={field} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setView({ kind: "reasons" })} className="flex-1 rounded-lg border border-border py-2 font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">Back</button>
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-danger py-2 font-medium text-accent-foreground transition hover:brightness-110 disabled:opacity-60">Send request</button>
            </div>
          </form>
        )}

        {view.kind === "done" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center text-[13px] text-foreground">
            <span className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-accent" />{view.message}</span>
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">Done</button>
          </div>
        )}

        {error && <p role="alert" className="mt-2 px-1 text-[12px] text-danger">{error}</p>}
      </motion.div>
    </motion.div>
  )
}
