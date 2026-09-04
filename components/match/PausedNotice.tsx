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
      <div className="absolute -right-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-accent/[0.07] blur-[120px]" aria-hidden="true" />

      <header className="absolute right-5 top-5 z-20 flex items-center gap-5 sm:right-8 sm:top-7 lg:right-10">
        {onlineCount !== null && (
          <div className="flex items-center gap-2 text-[12px] text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-online" />
            {onlineCount === 1 ? "1 online" : `${onlineCount.toLocaleString()} online`}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <BrandMark size={24} />
          <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Rizzuno</span>
        </div>
      </header>

      <main className="relative z-10 flex h-full items-end px-6 pb-28 pt-24 sm:items-center sm:px-10 sm:pb-20 lg:pl-[58%] lg:pr-10 xl:pl-[52%]">
        <section className="max-w-[46rem]">
          <h1 className="text-[clamp(3.25rem,11vw,5.8rem)] font-bold leading-[0.94] tracking-[-0.065em] text-foreground lg:text-[clamp(4.5rem,7vw,7rem)]">
            Meet someone
            <span className="block text-white/32">new.</span>
          </h1>
        </section>
      </main>

      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-3 sm:bottom-8 sm:right-10 lg:left-[58%] lg:right-auto xl:left-[52%]">
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
