"use client"

import { motion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels — width and both border weights scale with it. Defaults to the small inline size used next to the wordmark. */
  size?: number
}

/**
 * Rizzuno's mark — a single card, not a symbol drawn on one. The product is
 * fundamentally a stack of video cards swiped through one at a time (see
 * SwipeStage), so the mark is that same shape: a bordered card outline with
 * a second, inset frame line for a bit of a real card's edge. No pips, no
 * numerals, nothing UNO's own mark would put in the middle — just the card.
 * The slight tilt echoes the swipe gesture itself rather than being a
 * generic decorative wobble.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const width = Math.round(size * 0.72)
  const outerBorder = Math.max(1.5, Math.round(size * 0.09 * 10) / 10)
  const inset = Math.max(2, Math.round(size * 0.16))
  const innerBorder = Math.max(1, Math.round(size * 0.05 * 10) / 10)

  return (
    <motion.span
      className="relative inline-block rounded-[22%] border border-accent"
      style={{ width, height: size, borderWidth: outerBorder }}
      animate={{ rotate: [-5, 5, -5] }}
      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden="true"
    >
      <span
        className="absolute rounded-[16%] border border-accent-2"
        style={{ inset, borderWidth: innerBorder }}
      />
    </motion.span>
  )
}
