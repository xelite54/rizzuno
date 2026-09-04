"use client"

import { motion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels — width, overlap, border, and corner radius all scale off it. Defaults to the small inline size used next to the wordmark. */
  size?: number
}

// A real UNO card measures 3.5" x 2.25" — used here exactly, rather than an
// arbitrary "looks about right" rectangle, so the mark actually reads as a
// card and not just a rounded box. Corner radius is a fixed proportion of
// that same real card's own gentle corner round (about 1/8" on a 3.5" card
// — small, not the deep pill curve a generic UI "rounded-2xl" would give).
const UNO_CARD_RATIO = 2.25 / 3.5
const UNO_CORNER_RATIO = 0.125 / 3.5

/**
 * Rizzuno's mark — two cards, not a symbol drawn on one. The product is
 * fundamentally a stack of video cards swiped through one at a time (see
 * SwipeStage), so the mark is that same shape, doubled: two transparent,
 * UNO-proportioned card outlines, one behind the other, in the app's two
 * accent colors, letting whatever's behind them show through. No pips,
 * numerals, or symbol on either card — just the two of them.
 *
 * One card holds still; the other nudges left and tilts on a slow loop —
 * not both drifting toward and apart from each other, which is what this
 * used to do. A single motion source reads as one considered animation;
 * two cards drifting independently read as noise, the same reasoning
 * PausedNotice.tsx's own (separately built, tile-scale) two-card stack
 * uses for its identical one-static-one-moving treatment.
 *
 * This is the one definition of the mark — every other place it appears
 * (StatusPill, SelfPanel, the sign-in screen) renders this exact
 * component rather than its own copy, so there's nothing to keep in sync
 * by hand except app/icon.tsx, the one static (non-React) exception.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const width = Math.round(size * UNO_CARD_RATIO)
  const border = Math.max(1.5, Math.round(size * 0.09 * 10) / 10)
  const radius = Math.max(2, Math.round(size * UNO_CORNER_RATIO * 10) / 10)
  const overlap = width * 0.5
  const amplitude = size * 0.18

  const cardStyle = { width, height: size, borderWidth: border, borderRadius: radius }

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <span className="border border-accent" style={cardStyle} />
      <motion.span
        className="border border-accent-2"
        style={{ ...cardStyle, marginLeft: -overlap }}
        animate={{ x: [0, -amplitude, 0], rotate: [0, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut" }}
      />
    </span>
  )
}
