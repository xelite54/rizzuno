"use client"

import { motion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels — width, overlap, border, and corner radius all scale off it. Defaults to the small inline size used next to the wordmark. */
  size?: number
}

// Matches PausedNotice.tsx's own two-card stack exactly — same aspect
// ratio (its cards are `aspect-[3/4]`), same solid surface-1 fill, same
// /50-opacity accent borders, same shadow, same one-static-one-moving
// motion (duration/repeatDelay/ease). This is that same mark, just at
// icon scale — not a separately designed one that happens to look similar.
const CARD_RATIO = 3 / 4

// Border width and corner radius are the one thing that does NOT linearly
// scale down from PausedNotice's own pixel values — its 2px border on a
// 176px-wide card is about 1% of the width; at BrandMark's icon sizes
// (16–32px) a literal 1% border is under a pixel and disappears. These
// keep a higher proportional weight (with a floor) so the border actually
// reads as a border at icon size — standard optical-scaling practice, the
// same reason a favicon's stroke is never just a shrunk photograph.
const BORDER_RATIO = 0.1
const CORNER_RATIO = 0.12

/**
 * Rizzuno's mark — two cards, not a symbol drawn on one. The product is
 * fundamentally a stack of video cards swiped through one at a time (see
 * SwipeStage), so the mark is that same shape, doubled, in the app's two
 * accent colors. No pips, numerals, or symbol on either card — just the
 * two of them.
 *
 * One card holds still; the other nudges left and tilts on a slow loop —
 * not both drifting toward and apart from each other, which is what this
 * used to do. A single motion source reads as one considered animation;
 * two cards drifting independently read as noise.
 *
 * This is the one definition of the mark — every other place it appears
 * (StatusPill, SelfPanel, the sign-in screen) renders this exact
 * component rather than its own copy, so there's nothing to keep in sync
 * by hand except app/icon.tsx, the one static (non-React) exception.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const width = Math.round(size * CARD_RATIO)
  const border = Math.max(1.5, Math.round(size * BORDER_RATIO * 10) / 10)
  const radius = Math.max(2, Math.round(size * CORNER_RATIO * 10) / 10)
  const overlap = width * 0.5
  const amplitude = size * 0.18

  const cardStyle = { width, height: size, borderWidth: border, borderRadius: radius }

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <span className="border border-accent/50 bg-surface-1 shadow-sm shadow-black/30" style={cardStyle} />
      <motion.span
        className="border border-accent-2/50 bg-surface-1 shadow-sm shadow-black/30"
        style={{ ...cardStyle, marginLeft: -overlap }}
        animate={{ x: [0, -amplitude, 0], rotate: [0, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut" }}
      />
    </span>
  )
}
