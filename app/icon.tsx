import { ImageResponse } from "next/og"
import { ConnectionCardFace } from "@/components/match/ConnectionCardFace"

export const size = { width: 64, height: 64 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", position: "relative", width: 46, height: 41 }}>
        <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 29, height: 41 }}>
          <ConnectionCardFace />
        </div>
        <div style={{ display: "flex", position: "absolute", left: 17, top: 0, width: 29, height: 41 }}>
          <ConnectionCardFace front />
        </div>
      </div>
    </div>,
    size,
  )
}
