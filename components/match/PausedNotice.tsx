"use client"

import { motion } from "motion/react"
import { BrandMark } from "./BrandMark"
import { CameraIcon } from "@/components/icons"

type PausedNoticeProps = {
  /** How many accounts currently have a live connection — omitted entirely (not shown as a placeholder "0") until the server's first "online-count" arrives. See useMatchmaking.ts's `onlineCount`. */
  onlineCount?: number | null
}

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
 * — the little card demo at the bottom shows the actual gesture instead of
 * describing it, and the accessible description already lives on
 * SwipeStage's own draggable region (its `aria-label`), so there's nothing
 * for text here to duplicate.
 *
 * The gesture demo is deliberately built from the app's own vocabulary —
 * a small dark tile with a real video-tile border, tilting and dragging
 * left the same way SwipeStage's own drag physics do (x -400..0 maps to
 * rotate -8..0deg there; this mirrors that same tilt-while-dragging feel
 * at a smaller scale) — rather than a generic row of arrow icons. It's a
 * rehearsal of the exact motion about to happen, not an abstract hint.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-surface-2 px-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <BrandMark size={52} />
        <span className="text-[11px] font-bold uppercase tracking-[0.4em] text-accent">Rizzuno</span>
      </div>

      <h2 className="max-w-[15ch] text-[28px] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-[34px]">
        Meet someone new.
      </h2>

      {onlineCount !== null && (
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online" />
          </span>
          <span className="text-[12px] font-semibold text-foreground/80">
            {onlineCount === 1 ? "1 online now" : `${onlineCount.toLocaleString()} online now`}
          </span>
        </div>
      )}

      {/* Swipe-left affordance — a miniature of the real card stack (see
          SwipeStage.tsx), tilting and dragging left on a loop, rather than
          a caption or a row of arrows explaining the gesture. Purely
          decorative: the interactive element this stands in front of
          already carries its own aria-label. */}
      <div className="relative flex h-16 w-28 items-center justify-center" aria-hidden="true">
        {/* The next card, peeking from behind — same layered-stack read as
            the real thing, just static here. */}
        <div className="absolute h-14 w-20 translate-x-1 translate-y-0.5 rotate-2 rounded-2xl border border-border bg-surface" />
        <motion.div
          className="absolute flex h-14 w-20 items-center justify-center rounded-2xl border border-accent/40 bg-surface-1 shadow-lg shadow-black/30"
          animate={{ x: [0, -46, 0], rotate: [0, -9, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" }}
        >
          <CameraIcon className="h-4 w-4 text-foreground/40" />
        </motion.div>
      </div>
    </div>
  )
}
