import { ImageResponse } from "next/og"

// Static favicon version of the playing-card mark in BrandMark.tsx.
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
              background: "#6637a3",
              display: "flex",
              transform: "rotate(5deg)",
            }}
          >
            <div
              style={{
                margin: 5,
                flex: 1,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,.35)",
                transform: "rotate(-24deg)",
              }}
            />
          </div>
          <div
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              borderRadius: CARD_RADIUS,
              border: "2px solid rgba(255,255,255,.35)",
              background: "#e9416d",
              color: "rgba(255,255,255,.95)",
              fontSize: 14,
              fontWeight: 900,
              fontStyle: "italic",
              marginLeft: -CARD_WIDTH * 0.43,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            R
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
