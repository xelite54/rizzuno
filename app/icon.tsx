import { ImageResponse } from "next/og"

// Rizzuno's mark, laid sideways as a figure eight / infinity symbol — two
// rings in the app's accent colors, transparent everywhere else (see
// components/match/BrandMark.tsx for the same shape used in the UI itself).
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
          <div style={{ width: 30, height: 30, borderRadius: "50%", border: "6px solid #f04472" }} />
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "6px solid #9b5de5",
              marginLeft: -13,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  )
}
