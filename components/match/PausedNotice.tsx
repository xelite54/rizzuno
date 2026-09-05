"use client"

import { BrandMark } from "./BrandMark"
import { ChevronLeftIcon } from "@/components/icons"

type PausedNoticeProps = {
  /** Current live connections, shown beside the brand when available. */
  onlineCount?: number | null
  paused?: boolean
}

/**
 * Rizzuno's in-app home screen. It deliberately lives inside SwipeStage,
 * rather than in a route or modal, so the whole composition is the gesture
 * target: dragging it left moves this page away and starts the real search.
 */
export function PausedNotice({ onlineCount = null, paused = false }: PausedNoticeProps) {
  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden bg-[#0b0b0d] text-left">
      <header className="absolute inset-x-6 top-6 z-20 flex flex-wrap items-center justify-between gap-4 md:inset-x-10 md:top-8 xl:inset-x-14">
        <div className="flex items-center gap-3">
          <BrandMark size={28} />
          <span className="text-[17px] font-semibold tracking-[-0.025em] text-white/95">Rizzuno<span className="text-white/55">.com</span></span>
        </div>
        {onlineCount !== null && (
          <div className="flex items-center gap-2 text-[12px] text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-online/80" />
            {onlineCount === 1 ? "1 online" : `${onlineCount.toLocaleString()} online`}
          </div>
        )}
      </header>

      <div className="relative z-10 flex h-full items-end justify-center px-6 pb-10 pt-24 md:items-center md:px-10 md:pb-12 xl:px-14">
        <section className="w-full max-w-[38rem] text-center">
          <h1 className="text-[clamp(2rem,6.2vw,4.5rem)] font-semibold leading-[1.08] tracking-[-0.045em] text-white/95 md:text-[clamp(2rem,4.6vw,4.75rem)]">
            Different sides.
            <span className="block text-white/60">Same moment.</span>
          </h1>
          <p className="relative mx-auto mt-8 w-fit text-[14px] font-medium tracking-[-0.01em] text-white/70 md:mt-10">
            <ChevronLeftIcon className="absolute right-[calc(100%+0.5rem)] top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            Swipe left to {paused ? "resume" : "start"}
          </p>
        </section>
      </div>

    </div>
  )
}
