import { ImageResponse } from "next/og"

// Rizzuno's mark — two overlapping card outlines, no symbol on either one
// (see components/match/BrandMark.tsx for the same shape, animated, used in
// the UI itself; static here since ImageResponse can't render motion/react).
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
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 26, height: 36, borderRadius: 7, border: "5px solid #f04472", display: "flex" }} />
          <div
            style={{
              width: 26,
              height: 36,
              borderRadius: 7,
              border: "5px solid #9b5de5",
              marginLeft: -14,
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  )
}
