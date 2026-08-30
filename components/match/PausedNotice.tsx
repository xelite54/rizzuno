"use client"

import { motion } from "motion/react"
import { BrandMark } from "./BrandMark"
import { ChevronLeftIcon } from "@/components/icons"

type PausedNoticeProps = {
  /** How many accounts currently have a live connection — omitted entirely (not shown as a placeholder "0") until the server's first "online-count" arrives. See useMatchmaking.ts's `onlineCount`. */
  onlineCount?: number | null
}

// Three, not one — a single chevron read as a static arrow icon; three,
// staggered, is what actually reads as motion drifting in one direction.
const CHEVRON_TRAIL = [0, 1, 2]

/**
 * The calm paused state — full brand treatment, not just a small status
 * line. With no peer to show while paused, an empty video tile reads as
 * broken more than restful, so this replaces it entirely: this is
 * effectively Rizzuno's own homepage, shown right here instead of a blank
 * screen, for exactly as long as matching stays paused. Fills the same
 * absolutely-positioned area the status indicator normally uses (see
 * SwipeStage.tsx) with its own opaque background — not a separate screen or
 * modal, so Friends/Profile/everything else stay reachable exactly as
 * before.
 *
 * No instructional copy ("Matching paused", "Swipe left to keep looking")
 * — the chevron trail at the bottom demonstrates the actual gesture instead
 * of describing it, and the accessible description already lives on
 * SwipeStage's own draggable region (its `aria-label`), so there's nothing
 * for text here to duplicate.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-9 bg-surface-2 px-8 text-center">
      <div className="flex flex-col items-center gap-2.5">
        <BrandMark size={40} />
        <span className="text-[12px] font-semibold uppercase tracking-[0.35em] text-foreground/90">Rizzuno</span>
      </div>

      <h2 className="max-w-[16ch] text-[26px] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-[32px]">
        Meet someone new.
      </h2>

      {onlineCount !== null && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-online" />
          </span>
          <span className="text-[12.5px] font-medium text-foreground/70">
            {onlineCount === 1 ? "1 person online right now" : `${onlineCount.toLocaleString()} people online right now`}
          </span>
        </div>
      )}

      {/* Swipe-left affordance — echoes the same leftward drag that actually
          resumes matching (see SwipeStage's canSwipe/finishExit), rather
          than a caption explaining it. Purely decorative: the interactive
          element this stands in front of already carries its own
          aria-label. */}
      <div className="relative flex h-5 w-16 items-center justify-center" aria-hidden="true">
        {CHEVRON_TRAIL.map((i) => (
          <motion.span
            key={i}
            className="absolute text-foreground/50"
            animate={{ x: [18, -18], opacity: [0, 1, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.22 }}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </motion.span>
        ))}
      </div>
    </div>
  )
}
