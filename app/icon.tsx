import { ImageResponse } from "next/og"

// Rizzuno's mark — two solid, UNO-proportioned (3.5" x 2.25") cards, no
// symbol on either one (see components/match/BrandMark.tsx for the same
// shape, animated, used in the UI itself; static here since ImageResponse
// can't render motion/react).
export const size = { width: 64, height: 64 }
export const contentType = "image/png"

const CARD_HEIGHT = 40
const CARD_WIDTH = Math.round(CARD_HEIGHT * (2.25 / 3.5))
const CARD_RADIUS = 2

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
              border: "5px solid #f04472",
              background: "#17101d",
              display: "flex",
            }}
          />
          <div
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              borderRadius: CARD_RADIUS,
              border: "5px solid #9b5de5",
              background: "#17101d",
              marginLeft: -CARD_WIDTH / 2,
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  )
}
