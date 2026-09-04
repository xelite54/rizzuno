"use client"

import { motion, useReducedMotion } from "motion/react"
import { ChevronLeftIcon } from "@/components/icons"
import { BrandMark } from "./BrandMark"

type PausedNoticeProps = {
  /** How many accounts currently have a live connection — omitted until the server sends its first count. */
  onlineCount?: number | null
  /** A first visit starts matching; returning to the Stay Zone resumes it. */
  mode?: "start" | "resume"
}

/**
 * Rizzuno's in-app home screen. It deliberately lives inside SwipeStage,
 * rather than in a route or modal, so the whole composition is the gesture
 * target: dragging it left moves this page away and starts the real search.
 */
export function PausedNotice({ onlineCount = null, mode = "start" }: PausedNoticeProps) {
  const reduceMotion = useReducedMotion()
  const action = mode === "start" ? "start matching" : "resume matching"

  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden bg-[#0b0710] text-left">
      <div className="absolute -left-28 -top-32 h-[32rem] w-[32rem] rounded-full bg-accent/14 blur-[110px]" aria-hidden="true" />
      <div className="absolute -bottom-40 right-[-8rem] h-[34rem] w-[34rem] rounded-full bg-accent-2/16 blur-[120px]" aria-hidden="true" />
      <div
        className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        aria-hidden="true"
      />

      <header className="absolute left-5 right-5 top-5 z-20 flex items-center justify-between sm:left-8 sm:right-8 sm:top-7">
        <div className="flex items-center gap-3">
          <BrandMark size={26} />
          <span className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-foreground">Rizzuno</span>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-online shadow-[0_0_10px_rgba(61,220,151,.7)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">Stay Zone</span>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid h-full w-full max-w-6xl grid-cols-1 items-center px-6 pb-24 pt-24 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.78fr)] lg:gap-14 lg:px-14 lg:pb-16 lg:pt-20 xl:gap-24 xl:px-20">
        <section className="max-w-2xl self-end pb-3 sm:self-center sm:pb-0">
          <div className="mb-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.22em] text-accent sm:text-[11px]">
            <span className="h-px w-8 bg-accent/70" />
            Your pace. Your space.
          </div>
          <h1 className="max-w-[720px] text-[clamp(2.7rem,8vw,6.6rem)] font-extrabold leading-[0.86] tracking-[-0.065em] text-foreground lg:text-[clamp(4.5rem,7.2vw,7.5rem)]">
            Stay awhile.
            <span className="block bg-gradient-to-r from-accent via-[#fb7397] to-accent-2 bg-clip-text text-transparent">Go when ready.</span>
          </h1>
          <p className="mt-5 max-w-md text-[14px] leading-6 text-white/55 sm:mt-7 sm:text-[16px] sm:leading-7">
            This is your calm between conversations. One swipe brings someone new into the moment.
          </p>

          {onlineCount !== null && (
            <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-[12px] font-medium text-white/65 backdrop-blur-md sm:mt-8">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-online opacity-60 motion-reduce:animate-none" />
                <span className="relative h-2 w-2 rounded-full bg-online" />
              </span>
              {onlineCount === 1 ? "1 person is here now" : `${onlineCount.toLocaleString()} people are here now`}
            </div>
          )}
        </section>

        <div className="relative hidden h-[min(58vh,560px)] items-center justify-center lg:flex" aria-hidden="true">
          <motion.div
            className="absolute h-[76%] w-[62%] rounded-[2rem] border border-accent-2/35 bg-gradient-to-br from-accent-2/30 via-[#21142d] to-[#130e19] shadow-2xl shadow-black/40"
            animate={reduceMotion ? undefined : { x: [22, 8, 22], rotate: [8, 4, 8] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="absolute inset-x-5 top-5 h-1 rounded-full bg-white/10" />
            <div className="absolute bottom-6 left-6 h-3 w-24 rounded-full bg-white/10" />
          </motion.div>
          <motion.div
            className="relative z-10 h-[82%] w-[68%] overflow-hidden rounded-[2.25rem] border border-accent/40 bg-gradient-to-b from-[#35202c] via-[#1d141e] to-[#110c15] shadow-2xl shadow-black/60"
            animate={reduceMotion ? undefined : { x: [0, -12, 0], rotate: [0, -2.5, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="absolute left-1/2 top-[18%] h-28 w-28 -translate-x-1/2 rounded-full bg-gradient-to-br from-[#f690a9] to-accent-2/80 opacity-80 blur-[1px]" />
            <div className="absolute -bottom-[12%] left-1/2 h-[58%] w-[92%] -translate-x-1/2 rounded-[50%_50%_0_0] bg-gradient-to-b from-accent-2/50 to-accent/10" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,transparent_0,transparent_24%,rgba(8,5,12,.35)_72%)]" />
            <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between">
              <span className="h-2 w-24 rounded-full bg-white/20" />
              <span className="h-8 w-8 rounded-full border border-white/15 bg-black/20" />
            </div>
          </motion.div>
          <div className="absolute -right-4 top-[18%] rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-lg">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Next up</p>
            <p className="mt-1 text-sm font-semibold text-white/80">A new face</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 sm:bottom-7">
        <motion.div
          animate={reduceMotion ? undefined : { x: [5, -4, 5] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="flex items-center -space-x-2 text-accent"
          aria-hidden="true"
        >
          <ChevronLeftIcon className="h-5 w-5 opacity-40" />
          <ChevronLeftIcon className="h-5 w-5 opacity-70" />
          <ChevronLeftIcon className="h-5 w-5" />
        </motion.div>
        <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.18em] text-white/70 sm:text-[12px]">Swipe left to {action}</span>
      </div>
    </div>
  )
}
