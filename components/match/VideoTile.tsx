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

  // The `autoPlay` attribute alone silently does nothing on many mobile
  // browsers (iOS Safari in particular, and Chrome on Android under some
  // settings) once real audio is involved: they only auto-start unmuted
  // media as the direct, immediate result of a user gesture, and a
  // WebRTC remote stream only ever arrives well after whatever gesture
  // actually started the search — by the time `ontrack` fires, that
  // window has long since closed. `autoPlay` then just never starts
  // playback, with no error anywhere to notice — exactly why a peer's
  // video can render fine on desktop and never appear at all on mobile.
  // This tile's own local/self usage (always `muted`) was never actually
  // affected — autoplaying MUTED media is allowed essentially everywhere
  // — but the fix below is applied unconditionally since it's a no-op
  // whenever autoplay was already going to succeed on its own.
  useEffect(() => {
    const video = videoRef.current
    if (!video || video.srcObject === stream) return
    video.srcObject = stream
    if (!stream) return

    const playPromise = video.play()
    if (playPromise === undefined) return
    playPromise.catch((err) => {
      console.error("videoTile: autoplay blocked, retrying muted", { error: String(err) })
      // A muted play is near-universally allowed even where starting
      // unmuted from a standstill wasn't — this is what actually makes
      // the picture itself show up. Restoring the originally intended
      // muted state right after usually succeeds too: the gesture-gated
      // restriction applies to STARTING playback with audio, not to
      // unmuting media that's already playing.
      video.muted = true
      video
        .play()
        .then(() => {
          if (!muted) video.muted = false
        })
        .catch((err2) => {
          console.error("videoTile: muted autoplay retry also failed", { error: String(err2) })
        })
    })
  }, [stream, muted])

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
