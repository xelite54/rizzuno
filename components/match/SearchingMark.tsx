"use client"

import { motion } from "motion/react"

// Same exact UNO card ratio (3.5" x 2.25") and natural corner treatment as
// BrandMark.tsx's mark — this is that same shape, sized for sitting next to
// a status pill's own text rather than parameterized by a `size` prop.
const UNO_CARD_RATIO = 2.25 / 3.5
const CARD_HEIGHT = 26
const CARD_WIDTH = Math.round(CARD_HEIGHT * UNO_CARD_RATIO)
const CARD_BORDER = Math.max(1.2, Math.round(CARD_HEIGHT * 0.09 * 10) / 10)
const CARD_RADIUS = 2
const OVERLAP = CARD_WIDTH * 0.5

const cardStyle = { width: CARD_WIDTH, height: CARD_HEIGHT, borderWidth: CARD_BORDER, borderRadius: CARD_RADIUS }

/**
 * Two cards drifting toward each other and apart, the near one occluding
 * the far one where they overlap — the same motion (and the same "looking
 * for a connection between two people" idea) as BrandMark.tsx's mark,
 * carried over here as the matching-specific version of it, not a generic
 * spinner or status dot.
 */
export function SearchingMark() {
  return (
    <span className="relative inline-flex shrink-0 items-center" style={{ height: CARD_HEIGHT }} aria-hidden="true">
      <motion.span
        className="border border-accent bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
        style={cardStyle}
        animate={{ x: [0, 5, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="border border-accent-2 bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
        style={{ ...cardStyle, marginLeft: -OVERLAP }}
        animate={{ x: [0, -5, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  )
}
