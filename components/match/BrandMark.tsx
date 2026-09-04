"use client"

import { motion, useReducedMotion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels; every other dimension scales from it. */
  size?: number
}

const CARD_RATIO = 0.68
const CORNER_RATIO = 0.12

/**
 * Rizzuno's connection mark. Each card carries one half of the same heart:
 * the purple half stays grounded while the coral half nudges toward it. The
 * two separate people/cards becoming one symbol mirrors the product without
 * borrowing the visual language of a playing-card game.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const reduceMotion = useReducedMotion()
  const width = Math.round(size * CARD_RATIO)
  const border = Math.max(1, Math.round(size * 0.055 * 10) / 10)
  const radius = Math.max(2, Math.round(size * CORNER_RATIO * 10) / 10)
  const overlap = width * 0.43
  const amplitude = size * 0.2
  const cardStyle = { width, height: size, borderWidth: border, borderRadius: radius }

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <span
        className="relative overflow-hidden border-white/15 bg-gradient-to-br from-[#4e3562] to-[#251b2d] shadow-sm shadow-black/40"
        style={{ ...cardStyle, transform: "rotate(5deg)" }}
      >
        <svg
          viewBox="0 0 16 20"
          fill="none"
          className="absolute right-[-8%] top-1/2 h-[62%] w-[78%] -translate-y-1/2 text-white/75"
          aria-hidden="true"
        >
          <path d="M8 4.3C7.75 3.55 6.95 3 5.72 3 3.28 3 1.5 4.95 1.5 7.45 1.5 11.55 5.86 15.1 8 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <motion.span
        className="relative z-10 overflow-hidden border-white/15 bg-gradient-to-br from-[#bd4568] to-[#682d4c] shadow-sm shadow-black/50"
        style={{ ...cardStyle, marginLeft: -overlap }}
        animate={reduceMotion ? undefined : { x: [0, -amplitude, 0], rotate: [0, -8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.1, ease: "easeInOut" }}
      >
        <svg
          viewBox="0 0 16 20"
          fill="none"
          className="absolute left-[-8%] top-1/2 h-[62%] w-[78%] -translate-y-1/2 text-white/80"
          aria-hidden="true"
        >
          <path d="M8 4.3C8.25 3.55 9.05 3 10.28 3 12.72 3 14.5 4.95 14.5 7.45 14.5 11.55 10.14 15.1 8 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </motion.span>
    </span>
  )
}
