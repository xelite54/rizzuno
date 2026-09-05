"use client"

import { motion, useReducedMotion } from "motion/react"
import { ConnectionCardFace } from "./ConnectionCardFace"

/** One fixed card and one gently approaching heart card, in a stable frame. */
export function BrandMark({ size = 16 }: { size?: number }) {
  const reduceMotion = useReducedMotion()
  const width = size * (24 / 34)
  const offset = width * 0.6

  return (
    <span className="relative inline-block shrink-0 align-middle" style={{ width: width + offset, height: size }} aria-hidden="true">
      <span className="absolute left-0 top-0" style={{ width, height: size }}>
        <ConnectionCardFace />
      </span>
      <motion.span
        className="absolute top-0 origin-bottom"
        style={{ left: offset, width, height: size }}
        initial={false}
        animate={reduceMotion ? { x: 0, rotate: 0 } : { x: [0, -size * 0.09, 0], rotate: [0, -4, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 2.8, ease: "easeInOut" }}
      >
        <ConnectionCardFace front />
      </motion.span>
    </span>
  )
}
