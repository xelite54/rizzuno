import { ImageResponse } from "next/og"

// Static favicon version of the paired connection mark in BrandMark.tsx.
export const size = { width: 64, height: 64 }
export const contentType = "image/png"

const CARD_HEIGHT = 40
const CARD_WIDTH = Math.round(CARD_HEIGHT * 0.68)
const CARD_RADIUS = 5

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              borderRadius: CARD_RADIUS,
              border: "2px solid rgba(255,255,255,.3)",
              background: "linear-gradient(135deg, #4e3562, #251b2d)",
              color: "rgba(255,255,255,.72)",
              fontSize: 18,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(5deg)",
            }}
          >
            ‹
          </div>
          <div
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              borderRadius: CARD_RADIUS,
              border: "2px solid rgba(255,255,255,.35)",
              background: "linear-gradient(135deg, #bd4568, #682d4c)",
              color: "rgba(255,255,255,.95)",
              fontSize: 14,
              fontWeight: 500,
              marginLeft: -CARD_WIDTH * 0.43,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ›
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
