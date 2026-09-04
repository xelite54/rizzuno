"use client"

import { motion, useReducedMotion } from "motion/react"
import { ChevronLeftIcon } from "@/components/icons"

type PausedNoticeProps = {
  /** A first visit starts matching; returning to the home state resumes it. */
  mode?: "start" | "resume"
}

/**
 * Rizzuno's in-app home screen. It deliberately lives inside SwipeStage,
 * rather than in a route or modal, so the whole composition is the gesture
 * target: dragging it left moves this page away and starts the real search.
 */
export function PausedNotice({ mode = "start" }: PausedNoticeProps) {
  const reduceMotion = useReducedMotion()
  const action = mode === "start" ? "start" : "resume"

  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden bg-[#0b0b0d] text-left">
      <div className="absolute -right-48 -top-56 h-[36rem] w-[36rem] rounded-full bg-accent-2/[0.055] blur-[140px]" aria-hidden="true" />

      <main className="relative z-10 flex h-full items-end px-6 pb-28 pt-24 sm:items-center sm:px-10 sm:pb-20 lg:pl-[58%] lg:pr-12 xl:pl-[52%] xl:pr-16">
        <section className="max-w-[42rem]">
          <h1 className="text-balance text-[clamp(2.75rem,10vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.052em] text-white/95 lg:text-[clamp(3.75rem,5.7vw,5.75rem)]">
            Different sides.
            <span className="mt-1 block text-white/38">Same moment.</span>
          </h1>
        </section>
      </main>

      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 sm:bottom-8">
        <motion.div
          animate={reduceMotion ? undefined : { x: [3, -3, 3] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="flex items-center -space-x-2 text-white/45"
          aria-hidden="true"
        >
          <ChevronLeftIcon className="h-[18px] w-[18px] opacity-20" />
          <ChevronLeftIcon className="h-[18px] w-[18px] opacity-50" />
          <ChevronLeftIcon className="h-[18px] w-[18px] opacity-80" />
        </motion.div>
        <span className="whitespace-nowrap text-[13px] font-medium tracking-[-0.01em] text-white/48">Swipe left to {action}</span>
      </div>
    </div>
  )
}
