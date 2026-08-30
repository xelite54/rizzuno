"use client"

import { motion } from "motion/react"

type BrandMarkProps = {
  /** Ring diameter in pixels — border thickness and overlap scale with it. Defaults to the small inline size used next to the wordmark. */
  size?: number
}

/**
 * Rizzuno's logo — two rings forming a sideways figure eight, drawn as
 * outlines rather than solid circles. Both rings drift toward each other
 * and apart — the "two people meeting" motion used everywhere the brand
 * appears.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const border = Math.max(2, Math.round(size * 0.16))
  const overlap = size * 0.44
  const amplitude = size * 0.2

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <motion.span
        className="rounded-full border border-accent"
        style={{ width: size, height: size, borderWidth: border }}
        animate={{ x: [0, amplitude, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="rounded-full border border-accent-2"
        style={{ width: size, height: size, borderWidth: border, marginLeft: -overlap }}
        animate={{ x: [0, -amplitude, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  )
}
