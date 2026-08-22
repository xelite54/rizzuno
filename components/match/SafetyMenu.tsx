"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { DotsIcon, CheckIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"
import type { ReportCategory } from "@/lib/signaling/protocol"

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "sexual_content", label: "Sexual content" },
  { value: "harassment", label: "Harassment" },
  { value: "hate", label: "Hate" },
  { value: "scam", label: "Scam" },
  { value: "spam", label: "Spam" },
  { value: "underage_concern", label: "Underage concern" },
  { value: "violence", label: "Violence" },
  { value: "other", label: "Other" },
]

type SafetyMenuProps = {
  disabled: boolean
  onViewProfile: () => void
  onReport: (category: ReportCategory) => void
  onBlock: () => void
}

export function SafetyMenu({ disabled, onViewProfile, onReport, onBlock }: SafetyMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"menu" | "categories" | "confirmBlock" | "confirmed">("menu")

  function close() {
    setOpen(false)
    setTimeout(() => setView("menu"), 200)
  }

  function submitReport(category: ReportCategory) {
    onReport(category)
    setView("confirmed")
    setTimeout(close, 1100)
  }

  if (disabled) return null

  return (
    <div className="absolute right-5 top-5 z-20">
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
            className="absolute right-0 top-11 w-56 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
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
                  onClick={() => setView("categories")}
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

            {view === "categories" && (
              <div className="flex flex-col">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => submitReport(category.value)}
                    className="rounded-xl px-3 py-2 text-left text-[13px] text-foreground hover:bg-surface-2"
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            )}

            {view === "confirmed" && (
              <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-foreground">
                <CheckIcon className="h-3.5 w-3.5 text-accent" />
                Report sent — thanks
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
