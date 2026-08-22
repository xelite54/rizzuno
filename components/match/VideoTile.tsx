"use client"

import { useEffect, useRef } from "react"

type VideoTileProps = {
  stream: MediaStream | null
  muted?: boolean
  mirrored?: boolean
  className?: string
}

export function VideoTile({ stream, muted, mirrored, className }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (video && video.srcObject !== stream) {
      video.srcObject = stream
    }
  }, [stream])

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""} ${className ?? ""}`}
    />
  )
}
