"use client"

import { motion } from "motion/react"

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
 * Bazoocam, Holla): a plain, direct, VIDEO-TILE-SHAPED placeholder, not a
 * marketing hero. Their taglines live on the outward landing page; the
 * in-app screen itself is short and functional. Rizzuno's own equivalent
 * is its swipe gesture (Holla uses the same swipe-to-match model), so the
 * placeholder is a real "no video yet" tile — echoing SelfPanel.tsx's own
 * empty-camera treatment rather than inventing a separate look for it —
 * doubled into the same two-card read BrandMark.tsx already stands for
 * (see its own doc comment: "the product is fundamentally a stack of
 * video cards"), each card carrying one of the two accent colors instead
 * of both dumped into one flat tile. No caption spelling the gesture out
 * ("Swipe left to start") — the back card doing the actual nudge-and-tilt
 * motion is the demonstration; a real competitor's screen doesn't caption
 * its own animation either. No separate marketing headline — "Meet
 * someone new." already lives on SignInLanding, and this screen isn't
 * that one.
 *
 * The small mark inside the front card is a plain, STATIC pair of
 * outlines — deliberately not the animated <BrandMark> component, even
 * though it's built to the exact same proportions. <BrandMark> runs its
 * own independent drift (both its cards sliding toward and apart from
 * each other) — nested inside the big cards' own nudge-and-tilt loop,
 * that was two unrelated motions competing in the same small area at
 * once. One motion source (the big back card) reads as a considered
 * animation; two overlapping ones reads as noise.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-surface-2 px-8 text-center">
      {/* Two cards, not one — the same stack BrandMark's own two outlined
          cards already stand for, just at tile scale and with roles this
          time: the front one stays put ("in the middle"), the back one
          does the moving, nudging left and tilting on a slow loop. Not a
          full demo of the swipe (it needs to stay legible, not fly off)
          — just enough motion to read as "this can be dragged", the same
          restraint a real onboarding affordance uses rather than
          replaying the whole gesture. Purely decorative — the
          interactive element this sits in front of (SwipeStage's own
          draggable region) already carries the real aria-label. */}
      {/* bg-surface-2 here too, matching the panel behind it — the back
          card below moves off its resting position (nudge/tilt), and
          without a real fill of its own this wrapper would show through
          as a literal transparent gap right where the back card just
          was, instead of just more of the same panel. */}
      <div className="relative aspect-[3/4] w-44 rounded-[28px] bg-surface-2 sm:w-56" aria-hidden="true">
        <motion.div
          className="absolute inset-0 rounded-[28px] border-2 border-accent-2/50 bg-surface-1 shadow-lg shadow-black/30"
          animate={{ x: [10, -6, 10], y: [7, 7, 7], rotate: [5, -2, 5] }}
          transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut" }}
        />
        <div className="relative z-10 flex h-full w-full flex-col items-center justify-center rounded-[28px] border-2 border-accent/50 bg-surface-1 shadow-lg shadow-black/30">
          {/* Static — see this component's own doc comment for why this
              isn't <BrandMark>. Sized to match its size=48 output exactly. */}
          <span className="relative inline-flex items-center" style={{ height: 48 }}>
            <span className="border border-accent" style={{ width: 31, height: 48, borderWidth: 4.3, borderRadius: 2 }} />
            <span
              className="border border-accent-2"
              style={{ width: 31, height: 48, borderWidth: 4.3, borderRadius: 2, marginLeft: -15.5 }}
            />
          </span>
        </div>
      </div>

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
  )
}
