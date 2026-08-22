"use client"

import { BrandMark } from "./BrandMark"

/**
 * The calm paused state — replaces the status indicator in the same video
 * area, not a separate screen or modal. Friends, Profile, and everything
 * else stay reachable exactly as before.
 *
 * The logo here only animates the purple ring, sliding it left and fading
 * — a demonstration of the actual swipe-left gesture that resumes matching,
 * not the "two rings meeting" motion the mark uses everywhere else. Nothing
 * else animates: no bouncing hints, no separate gesture demo, just this and
 * two plain, static lines of text.
 */
export function PausedNotice() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <BrandMark size={40} variant="swipeLeft" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-[15px] font-semibold text-foreground [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]">
          Matching paused
        </p>
        <p className="text-[13px] text-foreground/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]">
          Swipe left to keep looking
        </p>
      </div>
    </div>
  )
}
