"use client"

import { BrandMark } from "./BrandMark"

type PausedNoticeProps = {
  /** Current live connections, shown beside the brand when available. */
  onlineCount?: number | null
}

/**
 * Rizzuno's in-app home screen. It deliberately lives inside SwipeStage,
 * rather than in a route or modal, so the whole composition is the gesture
 * target: dragging it left moves this page away and starts the real search.
 */
export function PausedNotice({ onlineCount = null }: PausedNoticeProps) {
  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden bg-[#0b0b0d] text-left">
      <header className="absolute right-5 top-5 z-20 flex flex-col items-end gap-1.5 sm:right-8 sm:top-7 lg:left-10 lg:right-auto lg:top-8 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex items-center gap-3">
          <BrandMark size={30} />
          <span className="text-[16px] font-semibold tracking-[-0.02em] text-white/95">Rizzuno.com</span>
        </div>
        {onlineCount !== null && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-online/80" />
            {onlineCount === 1 ? "1 online" : `${onlineCount.toLocaleString()} online`}
          </div>
        )}
      </header>

      <main className="relative z-10 flex h-full items-end px-6 pb-28 pt-24 sm:items-center sm:px-10 sm:pb-20 lg:pl-[28%] lg:pr-12 xl:pl-[18%] xl:pr-16">
        <section className="max-w-[42rem]">
          <h1 className="text-balance text-[clamp(2.75rem,10vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.052em] text-white/95 lg:text-[clamp(3.75rem,5.7vw,5.75rem)]">
            Different sides.
            <span className="mt-1 block text-white/38">Same moment.</span>
          </h1>
        </section>
      </main>

    </div>
  )
}
