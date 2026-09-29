"use client"

import styles from "./MatchStage.module.css"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { DotsIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"
import type { ReportCategory } from "@/lib/signaling/protocol"
import { ReportDialog, reportMatch } from "@/components/report/ReportDialog"

type SafetyMenuProps = {
  disabled: boolean
  /** The live room — the report's target, so it keeps its match context. */
  roomId: string | null
  onViewProfile: () => void
  /** Sends over the live socket while still in `expectedRoomId`; false once that call has ended. */
  onReport: (category: ReportCategory, details: string | undefined, expectedRoomId: string) => boolean
  onBlock: () => void
}

export function SafetyMenu({ disabled, roomId, onViewProfile, onReport, onBlock }: SafetyMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"menu" | "confirmBlock">("menu")
  // The room being reported, captured when Report is chosen: the dialog stays
  // open (and still reports that match) even if the call ends meanwhile.
  const [reportingRoomId, setReportingRoomId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  function close() {
    setOpen(false)
    setTimeout(() => setView("menu"), 200)
  }

  // Clicking anywhere outside the trigger/dropdown closes it, the same as
  // clicking the trigger again would — a click that lands elsewhere (the
  // video, another control) should never leave this open underneath
  // whatever was actually clicked.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  const dialog = (
    <ReportDialog
      open={!!reportingRoomId}
      target={{ type: "match", id: reportingRoomId ?? "" }}
      submitOrdinary={reportingRoomId ? reportMatch(reportingRoomId, onReport) : undefined}
      onClose={() => setReportingRoomId(null)}
    />
  )

  if (disabled) return dialog

  return (
    <>
    {dialog}
    {/* Keep safety separate from Stop; the menu can extend over the lower
        video panel and scroll within short landscape viewports. */}
    <div ref={rootRef} className={`${styles.safetyMenu} absolute right-3 top-9 z-40 md:right-5`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Safety options"
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-foreground transition-all duration-300 hover:bg-black/50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
          open ? "opacity-100" : "opacity-55"
        }`}
      >
        <DotsIcon className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="absolute right-0 top-11 max-h-[calc(100dvh-8rem)] w-56 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
          >
            {view === "menu" && (
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    onViewProfile()
                    close()
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                >
                  View profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReportingRoomId(roomId)
                    close()
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2"
                >
                  Report
                </button>
                <button
                  type="button"
                  onClick={() => setView("confirmBlock")}
                  className="rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                >
                  Block
                </button>
              </div>
            )}

            {view === "confirmBlock" && (
              <div className="px-2 py-1.5">
                <p className="mb-2 px-1 text-[12px] leading-snug text-muted">
                  Block them? They won&apos;t be able to contact you.
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setView("menu")}
                    className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onBlock()
                      close()
                    }}
                    className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
                  >
                    Block
                  </button>
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
