"use client"

import { useState } from "react"
import { CheckIcon } from "@/components/icons"
import { REPORT_CATEGORIES } from "./SafetyMenu"
import type { ReportCategory } from "@/lib/signaling/protocol"

type ReportButtonProps = {
  onReport: (category: ReportCategory) => void
  /** Classes for the initial "Report" trigger — callers style it to match whatever row of actions (Unfriend/Block, Add friend/Block, …) it sits alongside. */
  triggerClassName: string
  /** Fired right after a category is submitted (before the "sent" confirmation renders) — e.g. so a caller sitting inside a ProfileMenu dropdown can schedule that dropdown closing itself, the same way SafetyMenu's own report flow already does. */
  onSubmitted?: () => void
}

/**
 * The report flow for a profile viewed OUTSIDE a live call — a friend, a
 * pending request's sender, or a searched account (see FriendsPanel.tsx /
 * RequestProfileSheet.tsx). Mirrors SafetyMenu's in-call report exactly
 * (same categories, same "sent" confirmation) but as an inline expand
 * rather than a dropdown, since it sits inside a profile sheet already
 * scrolled to the relevant spot rather than floating over video.
 */
export function ReportButton({ onReport, triggerClassName, onSubmitted }: ReportButtonProps) {
  const [view, setView] = useState<"idle" | "categories" | "confirmed">("idle")

  function submit(category: ReportCategory) {
    onReport(category)
    setView("confirmed")
    onSubmitted?.()
  }

  if (view === "confirmed") {
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-[13px] text-foreground">
        <CheckIcon className="h-3.5 w-3.5 text-accent" />
        Report sent — thanks
      </div>
    )
  }

  if (view === "categories") {
    return (
      <div className="flex flex-col gap-1">
        {REPORT_CATEGORIES.map((category) => (
          <button
            key={category.value}
            type="button"
            onClick={() => submit(category.value)}
            className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-surface-2"
          >
            {category.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setView("idle")}
          className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-muted transition hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setView("categories")} className={triggerClassName}>
      Report
    </button>
  )
}
