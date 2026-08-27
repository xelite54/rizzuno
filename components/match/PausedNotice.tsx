"use client"

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
 * The logo's ring here only animates sliding left and fading — a
 * demonstration of the actual swipe-left gesture that resumes matching, not
 * the "two rings meeting" motion the mark uses everywhere else.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-7 px-8 text-center"
      style={{
        background:
          "radial-gradient(circle at 50% 22%, rgba(155,93,229,0.22), transparent 55%)," +
          "radial-gradient(circle at 10% 90%, rgba(240,68,114,0.16), transparent 50%)," +
          "var(--surface-2)",
      }}
    >
      <div className="flex flex-col items-center gap-2.5">
        <BrandMark size={44} variant="swipeLeft" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.35em] text-foreground/90">Rizzuno</span>
      </div>

      <h2 className="max-w-[16ch] text-[26px] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-[32px]">
        Meet someone new.
      </h2>

      {onlineCount !== null && (
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3.5 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-online" />
          </span>
          <span className="text-[12.5px] font-medium text-foreground/80">
            {onlineCount === 1 ? "1 person online right now" : `${onlineCount.toLocaleString()} people online right now`}
          </span>
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[14px] font-semibold text-foreground">Matching paused</p>
        <p className="text-[13px] text-muted">Swipe left to keep looking</p>
      </div>
    </div>
  )
}
