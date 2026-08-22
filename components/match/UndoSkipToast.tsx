"use client"

import { AnimatePresence, motion } from "motion/react"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"

type UndoSkipToastProps = {
  name: string | null
  windowMs: number
  onUndo: () => void
}

/**
 * A brief "you just skipped someone — undo?" pill, not a permanent control.
 * Shows for a few seconds after a skip and disappears on its own — the
 * underlying connection is genuinely still alive during that window, so
 * clicking Undo brings the same person back for real, not a re-creation.
 */
export function UndoSkipToast({ name, windowMs, onUndo }: UndoSkipToastProps) {
  return (
    <AnimatePresence>
      {name !== null && (
        <motion.button
          key={name}
          type="button"
          onClick={onUndo}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-full bg-black/60 py-2 pl-4 pr-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-sm"
        >
          <span className="whitespace-nowrap">Skipped {name}</span>
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold">Undo</span>
          <motion.span
            className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-white/60"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: windowMs / 1000, ease: "linear" }}
          />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
