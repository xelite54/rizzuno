import { ImageResponse } from "next/og"

// Rizzuno's mark — a single bordered card outline with a second, inset
// frame line, no symbol drawn on it (see components/match/BrandMark.tsx for
// the same shape used in the UI itself; static here since ImageResponse
// can't render motion/react's animated version).
export const size = { width: 64, height: 64 }
export const contentType = "image/png"

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
        <div
          style={{
            position: "relative",
            width: 34,
            height: 47,
            borderRadius: 8,
            border: "5px solid #f04472",
            display: "flex",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 6,
              borderRadius: 5,
              border: "3px solid #9b5de5",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  )
}
