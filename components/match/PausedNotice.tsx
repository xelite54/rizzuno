"use client"

import { motion } from "motion/react"
import { BrandMark } from "./BrandMark"

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
 * Rebuilt around how this genre of app actually treats its own in-app
 * waiting state (Omegle-style random video chat — OmeTV, Monkey,
 * Bazoocam, Holla): a plain, direct, VIDEO-TILE-SHAPED placeholder with a
 * clearly labeled action, not a marketing hero. Their taglines live on the
 * outward landing page; the in-app screen itself is short and functional
 * — "Hit Start", "Tap to Start", nothing more. Rizzuno's own equivalent of
 * that is its swipe gesture (Holla uses the same swipe-to-match model), so
 * the placeholder here IS a real "no video yet" tile — echoing
 * SelfPanel.tsx's own empty-camera treatment (BrandMark + one short line)
 * rather than inventing a separate look for it — labeled plainly with the
 * one thing to actually do, and nudged with a small, restrained nod
 * (rather than a full demonstration) toward the swipe that starts it. No
 * separate marketing headline — "Meet someone new." already lives on
 * SignInLanding, and this screen isn't that one.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-surface-2 px-8 text-center">
      {/* The placeholder tile itself — same role as SelfPanel's own "no
          video" state, just here for the peer's side instead. Nudges
          left and tilts on a slow loop: not a full demo of the swipe (it
          needs to stay put and legible), just enough motion to read as
          "this can be dragged", the same restraint a real onboarding
          affordance uses rather than replaying the whole gesture. Purely
          decorative — the interactive element it sits in front of
          (SwipeStage's own draggable region) already carries the real
          aria-label. */}
      <motion.div
        aria-hidden="true"
        className="flex aspect-[3/4] w-40 flex-col items-center justify-center gap-2.5 rounded-[28px] border border-border bg-surface-1 shadow-lg shadow-black/30 sm:w-48"
        animate={{ x: [0, -14, 0], rotate: [0, -3, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut" }}
      >
        <BrandMark size={40} />
      </motion.div>

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[14px] font-semibold text-foreground/85">Swipe left to start</p>
        {onlineCount !== null && (
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-online opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-online" />
            </span>
            {onlineCount === 1 ? "1 person online now" : `${onlineCount.toLocaleString()} people online now`}
          </p>
        )}
      </div>
    </div>
  )
}
