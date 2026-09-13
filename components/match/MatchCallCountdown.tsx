"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { matchCallCountdown } from "@/lib/matchCallLimit"

export function MatchCallCountdown({ expiresAt }: { expiresAt: number }) {
  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    const update = () => setSeconds(matchCallCountdown(expiresAt, Date.now()))
    update()
    const timer = setInterval(update, 250)
    document.addEventListener("visibilitychange", update)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", update)
    }
  }, [expiresAt])

  if (seconds === null || typeof document === "undefined") return null
  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-4 top-[max(6rem,env(safe-area-inset-top))] z-[60] flex justify-center md:top-8">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-black/80 px-5 py-3 text-white shadow-xl backdrop-blur-md">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-300 text-xl font-semibold tabular-nums text-black">{seconds}</span>
        <div>
          <p className="text-sm font-medium">{seconds > 0 ? "Call ending" : "Call ended"}</p>
          <p className="text-xs text-white/70">30-minute limit</p>
        </div>
      </div>
    </div>, document.body,
  )
}
