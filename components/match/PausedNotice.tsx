"use client"

import { motion, useReducedMotion } from "motion/react"
import { ChevronLeftIcon } from "@/components/icons"
import { BrandMark } from "./BrandMark"

type PausedNoticeProps = {
  /** How many accounts currently have a live connection — omitted until the server sends its first count. */
  onlineCount?: number | null
  /** A first visit starts matching; returning to the home state resumes it. */
  mode?: "start" | "resume"
}

/**
 * Rizzuno's in-app home screen. It deliberately lives inside SwipeStage,
 * rather than in a route or modal, so the whole composition is the gesture
 * target: dragging it left moves this page away and starts the real search.
 */
export function PausedNotice({ onlineCount = null, mode = "start" }: PausedNoticeProps) {
  const reduceMotion = useReducedMotion()
  const action = mode === "start" ? "start" : "resume"

  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden bg-[#0c0910] text-left">
      <div className="absolute -left-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-accent/[0.08] blur-[120px]" aria-hidden="true" />
      <div className="absolute right-[4%] top-1/2 hidden aspect-[3/4] w-[clamp(14rem,21vw,19rem)] -translate-y-1/2 rounded-[2rem] border border-white/[0.055] lg:block" aria-hidden="true" />

      <header className="absolute left-5 right-5 top-5 z-20 flex items-center justify-between sm:left-8 sm:right-8 sm:top-7 lg:left-12 lg:right-12">
        <div className="flex items-center gap-3">
          <BrandMark size={24} />
          <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Rizzuno</span>
        </div>
        {onlineCount !== null && (
          <div className="flex items-center gap-2 text-[12px] text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-online" />
            {onlineCount === 1 ? "1 person online" : `${onlineCount.toLocaleString()} people online`}
          </div>
        )}
      </header>

      <main className="relative z-10 flex h-full items-end px-6 pb-28 pt-24 sm:items-center sm:px-10 sm:pb-20 lg:px-12 lg:pr-[40%]">
        <section className="max-w-[46rem]">
          <h1 className="text-[clamp(3.25rem,11vw,5.8rem)] font-bold leading-[0.94] tracking-[-0.065em] text-foreground lg:text-[clamp(4.5rem,7vw,7rem)]">
            Meet someone
            <span className="block text-white/32">new.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[14px] leading-6 text-white/48 sm:mt-7 sm:text-[16px] sm:leading-7">
            One-on-one video chat with someone you haven&apos;t met yet.
          </p>
        </section>
      </main>

      <div className="absolute bottom-6 left-6 z-20 flex items-center gap-3 sm:bottom-8 sm:left-10 lg:left-12">
        <motion.div
          animate={reduceMotion ? undefined : { x: [3, -3, 3] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="flex items-center -space-x-2 text-white/55"
          aria-hidden="true"
        >
          <ChevronLeftIcon className="h-5 w-5 opacity-25" />
          <ChevronLeftIcon className="h-5 w-5 opacity-55" />
          <ChevronLeftIcon className="h-5 w-5 opacity-90" />
        </motion.div>
        <span className="whitespace-nowrap text-[12px] font-medium text-white/60">Swipe left to {action}</span>
      </div>
    </div>
  )
}
