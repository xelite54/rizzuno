"use client"

import { useEffect, useRef, useState } from "react"
import type { PeerPlaybackReport } from "@/lib/peerPlayback"

type VideoTileProps = {
  mirrored?: boolean
  className?: string
} & ({
  role: "self"
  localStream: MediaStream | null
  remoteStream?: never
  roomId?: never
  onPlaybackReady?: never
} | {
  role: "peer"
  remoteStream: MediaStream | null
  localStream?: never
  roomId: string | null
  onPlaybackReady?: (report: PeerPlaybackReport) => void
})

export function VideoTile(props: VideoTileProps) {
  const { role, mirrored, className, roomId, onPlaybackReady } = props
  const stream = role === "self" ? props.localStream : props.remoteStream
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const enableAudioRef = useRef<(() => void) | null>(null)
  const [blockedStream, setBlockedStream] = useState<MediaStream | null>(null)
  const audioBlocked = stream !== null && blockedStream === stream

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    const video: HTMLVideoElement = element
    const hasFrameCallback = typeof video.requestVideoFrameCallback === "function"
    let disposed = false
    let playPending = false
    let fallbackMuted = false
    let frameCallback: number | undefined
    let renderedFrames = 0
    let lastFrames = 0
    let lastTime = video.currentTime
    let lastProgress = performance.now()
    const current = () => !disposed && video.srcObject === stream
    const log = (event: string, extra = {}) => console.log(`videoTile: ${event}`, {
      role, roomId, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, ...extra,
    })
    const report = (playing: boolean) => {
      if (!current() || role !== "peer" || !roomId || !stream || !onPlaybackReady) return
      const track = stream.getVideoTracks()[0]
      if (!track) return
      const valid = playing && !video.paused && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && track.readyState === "live" && !track.muted
      onPlaybackReady({ roomId, stream, track, playing: valid, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight })
    }
    async function attemptPlay(reason: string) {
      if (!current() || !stream || playPending || !video.paused) return
      playPending = true
      try {
        await video.play()
      } catch (error) {
        if (!current()) return
        if (error instanceof DOMException && error.name === "AbortError") return
        log("autoplay retry muted", { reason, error: error instanceof Error ? error.name : "PlaybackError" })
        // Unmuting here without a user gesture can immediately pause Safari.
        // Keep the picture playing; the explicit audio action below restores sound.
        fallbackMuted = role === "peer"
        video.muted = true
        if (fallbackMuted) setBlockedStream(stream)
        try { await video.play() } catch (retryError) {
          if (current()) log("muted playback failed", { error: retryError instanceof Error ? retryError.name : "PlaybackError" })
        }
      } finally { playPending = false }
    }
    function resume() { if (document.visibilityState === "visible") void attemptPlay("foreground") }
    function playing() {
      if (!current()) return
      log("playing")
      // Prefer actual presented frames. Older browsers can prove playback
      // through playing + dimensions or advancing element time instead.
      if (!hasFrameCallback) report(true)
    }
    function frame() {
      if (!current()) return
      renderedFrames++
      lastProgress = performance.now()
      if (renderedFrames === 1) report(true)
      frameCallback = video.requestVideoFrameCallback(frame)
    }
    function unavailable() { report(false) }
    function canPlay() { void attemptPlay("canplay") }
    function trackUnmuted() { void attemptPlay("track-unmuted") }
    function trackChanged() {
      lastTime = video.currentTime
      lastProgress = performance.now()
      void attemptPlay("track-changed")
    }
    enableAudioRef.current = () => {
      if (!current() || role !== "peer") return
      // Invoked synchronously inside the click gesture.
      video.muted = false
      void video.play().then(() => {
        if (current()) { fallbackMuted = false; setBlockedStream(null) }
      }).catch(() => {
        if (!current()) return
        video.muted = true
        fallbackMuted = true
        setBlockedStream(stream)
        void attemptPlay("audio-gesture-failed")
      })
    }
    video.muted = role === "self"
    video.addEventListener("playing", playing)
    video.addEventListener("pause", unavailable)
    video.addEventListener("waiting", unavailable)
    video.addEventListener("emptied", unavailable)
    video.addEventListener("loadedmetadata", canPlay)
    video.addEventListener("canplay", canPlay)
    document.addEventListener("visibilitychange", resume)
    const tracks = stream?.getTracks() ?? []
    tracks.forEach(track => track.addEventListener("unmute", trackUnmuted))
    stream?.addEventListener("addtrack", trackChanged)
    stream?.addEventListener("removetrack", trackChanged)
    video.srcObject = stream
    log("srcObject set", { hasStream: Boolean(stream), videoTrackCount: stream?.getVideoTracks().length ?? 0 })
    if (stream && hasFrameCallback) frameCallback = video.requestVideoFrameCallback(frame)
    void attemptPlay("stream-bound")
    const healthTimer = setInterval(() => {
      if (!current() || !stream) return
      const progressed = hasFrameCallback ? renderedFrames > lastFrames : video.currentTime > lastTime
      if (progressed) { lastProgress = performance.now(); report(true) }
      else if (performance.now() - lastProgress > 5_000) {
        log("playback not advancing", { paused: video.paused, muted: video.muted })
        report(false)
      }
      lastFrames = renderedFrames
      lastTime = video.currentTime
      if (video.paused) {
        report(false)
        // Some browsers pause on the addition of an audio track. Do not
        // undo an already-established muted fallback on subsequent attempts.
        if (fallbackMuted) video.muted = true
        void attemptPlay("paused")
      }
    }, 1_000)
    return () => {
      report(false)
      disposed = true
      enableAudioRef.current = null
      clearInterval(healthTimer)
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback)
      video.removeEventListener("playing", playing)
      video.removeEventListener("pause", unavailable)
      video.removeEventListener("waiting", unavailable)
      video.removeEventListener("emptied", unavailable)
      video.removeEventListener("loadedmetadata", canPlay)
      video.removeEventListener("canplay", canPlay)
      document.removeEventListener("visibilitychange", resume)
      tracks.forEach(track => track.removeEventListener("unmute", trackUnmuted))
      stream?.removeEventListener("addtrack", trackChanged)
      stream?.removeEventListener("removetrack", trackChanged)
      if (video.srcObject === stream) video.srcObject = null
    }
  }, [stream, role, roomId, onPlaybackReady])

  return <>
    <video ref={videoRef} data-video-role={role} autoPlay playsInline muted={role === "self"}
      className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""} ${className ?? ""}`} />
    {role === "peer" && stream && audioBlocked && <button type="button"
      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); enableAudioRef.current?.() }}>
      Tap to hear
    </button>}
  </>
}
