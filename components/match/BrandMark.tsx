"use client"

import { motion, useReducedMotion } from "motion/react"

type BrandMarkProps = {
  /** Card height in pixels; every other dimension scales from it. */
  size?: number
}

const CARD_RATIO = 0.68
const CORNER_RATIO = 0.12

/**
 * Rizzuno's playing-card mark. The purple card stays grounded while the
 * coral R card nudges left, echoing the gesture that moves through matches.
 * Its tilted inner face gives it playing-card character without copying an
 * existing game's identity.
 */
export function BrandMark({ size = 16 }: BrandMarkProps) {
  const reduceMotion = useReducedMotion()
  const width = Math.round(size * CARD_RATIO)
  const border = Math.max(1, Math.round(size * 0.055 * 10) / 10)
  const radius = Math.max(2, Math.round(size * CORNER_RATIO * 10) / 10)
  const overlap = width * 0.43
  const amplitude = size * 0.2
  const inset = Math.max(1.5, size * 0.1)
  const cardStyle = { width, height: size, borderWidth: border, borderRadius: radius }

  return (
    <span className="relative inline-flex items-center" style={{ height: size }} aria-hidden="true">
      <span
        className="relative overflow-hidden border-white/20 bg-[#6637a3] shadow-sm shadow-black/40"
        style={{ ...cardStyle, transform: "rotate(5deg)" }}
      >
        <span
          className="absolute rotate-[-24deg] rounded-[50%] border border-white/25 bg-white/[0.08]"
          style={{ inset }}
        />
        <span className="absolute bottom-[16%] left-[18%] h-[12%] w-[12%] rounded-full bg-white/55" />
      </span>
      <motion.span
        className="relative z-10 overflow-hidden border-white/25 bg-[#e9416d] shadow-sm shadow-black/50"
        style={{ ...cardStyle, marginLeft: -overlap }}
        animate={reduceMotion ? undefined : { x: [0, -amplitude, 0], rotate: [0, -8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.1, ease: "easeInOut" }}
      >
        <span
          className="absolute rotate-[-24deg] rounded-[50%] border border-white/35 bg-white/[0.12]"
          style={{ inset }}
        />
        <span
          className="absolute inset-0 flex items-center justify-center font-black italic leading-none text-white/90"
          style={{ fontSize: Math.max(6, size * 0.32) }}
        >
          R
        </span>
      </motion.span>
    </span>
  )
}
