"use client"

import { motion } from "motion/react"

/**
 * Two cards drifting toward each other and apart, blending where they
 * overlap — the same motion (and the same "looking for a connection between
 * two people" idea) as BrandMark.tsx's mark, carried over here as the
 * matching-specific version of it, not a generic spinner or status dot.
 */
export function SearchingMark() {
  return (
    <div className="relative h-8 w-11 shrink-0">
      <motion.span
        className="absolute left-0 top-1/2 h-7 w-6 -translate-y-1/2 rounded-[22%] bg-accent/80 mix-blend-screen"
        animate={{ x: [0, 5, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="absolute right-0 top-1/2 h-7 w-6 -translate-y-1/2 rounded-[22%] bg-accent-2/80 mix-blend-screen"
        animate={{ x: [0, -5, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  )
}
