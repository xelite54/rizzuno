"use client"

import { motion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels — width, overlap, and border weight scale with it. Defaults to the small inline size used next to the wordmark. */
  size?: number
}

/**
 * Rizzuno's mark — two cards, not a symbol drawn on one. The product is
 * fundamentally a stack of video cards swiped through one at a time (see
 * SwipeStage), so the mark is that same shape, doubled: two bordered card
 * outlines overlapping and drifting toward each other and apart — the same
 * "two people meeting" motion the original ring mark used, just carried
 * over onto cards instead of circles. No pips, numerals, or symbol on
 * either card — just the two of them, in the app's two accent colors.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const width = Math.round(size * 0.72)
  const border = Math.max(1.5, Math.round(size * 0.09 * 10) / 10)
  const overlap = width * 0.55
  const amplitude = size * 0.18

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <motion.span
        className="rounded-[22%] border border-accent"
        style={{ width, height: size, borderWidth: border }}
        animate={{ x: [0, amplitude, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="rounded-[22%] border border-accent-2"
        style={{ width, height: size, borderWidth: border, marginLeft: -overlap }}
        animate={{ x: [0, -amplitude, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  )
}
