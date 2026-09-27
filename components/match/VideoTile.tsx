"use client"

import { useEffect, useRef, useState } from "react"
import type { PeerPlaybackReport } from "@/lib/peerPlayback"
import { playbackHasStalled } from "@/lib/peerPlayback"

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

/** Phone portrait, plus phone landscape (short coarse screens). Matches MatchStage.module.css's stacked phone layout. */
const PHONE_FRAMING_QUERY = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)"
/** Most a phone pane may zoom past "contain" toward "cover" before it letterboxes instead of cropping further. */
const MAX_PHONE_ZOOM = 1.35
/** Vertical anchor for crops: faces sit in the upper part of a selfie frame, so crop mostly from the bottom. */
const FACE_ANCHOR_Y = "35%"

/**
 * Zoom applied on top of `object-fit: contain` so the stream fills its pane
 * like `cover` when the aspect ratios are close, but never crops more than
 * MAX_PHONE_ZOOM would (e.g. a 16:9 desktop webcam in a near-square phone pane).
 */
export function phoneFrameZoom(paneWidth: number, paneHeight: number, videoWidth: number, videoHeight: number, maxZoom = MAX_PHONE_ZOOM): number {
  if (paneWidth <= 0 || paneHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return 1
  const paneAspect = paneWidth / paneHeight
  const videoAspect = videoWidth / videoHeight
  const coverOverContain = Math.max(paneAspect / videoAspect, videoAspect / paneAspect)
  return Math.min(coverOverContain, maxZoom)
}

type PhoneFraming = { zoom: number; anchorY: string }

/** Returns the phone framing for this <video>, or null off phones (desktop keeps plain object-cover). */
function usePhoneFraming(videoRef: React.RefObject<HTMLVideoElement | null>, maxZoom: number): PhoneFraming | null {
  const [framing, setFraming] = useState<PhoneFraming | null>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof window.matchMedia !== "function") return
    const query = window.matchMedia(PHONE_FRAMING_QUERY)
    const update = () => {
      if (!query.matches) { setFraming(null); return }
      const { clientWidth, clientHeight, videoWidth, videoHeight } = video
      const zoom = phoneFrameZoom(clientWidth, clientHeight, videoWidth, videoHeight, maxZoom)
      // Only a stream taller than its pane is cropped vertically; wider ones stay centered.
      const anchorY = videoWidth * clientHeight < videoHeight * clientWidth ? FACE_ANCHOR_Y : "50%"
      setFraming(previous => previous?.zoom === zoom && previous.anchorY === anchorY ? previous : { zoom, anchorY })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(video)
    // `resize` fires when the stream's dimensions change (rotation, peer switching cameras).
    video.addEventListener("resize", update)
    video.addEventListener("loadedmetadata", update)
    query.addEventListener("change", update)
    return () => {
      observer.disconnect()
      video.removeEventListener("resize", update)
      video.removeEventListener("loadedmetadata", update)
      query.removeEventListener("change", update)
    }
  }, [videoRef, maxZoom])
  return framing
}

export function VideoTile(props: VideoTileProps) {
  const { role, mirrored, className, roomId, onPlaybackReady } = props
  const stream = role === "self" ? props.localStream : props.remoteStream
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const enableAudioRef = useRef<(() => void) | null>(null)
  const [blockedStream, setBlockedStream] = useState<MediaStream | null>(null)
  const audioBlocked = stream !== null && blockedStream === stream
  // Your own camera always fills its pane (full cover, face-anchored); the peer's is capped to avoid over-cropping them.
  const phoneFraming = usePhoneFraming(videoRef, role === "self" ? Infinity : MAX_PHONE_ZOOM)

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
      if (playing && !valid) return
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
    function resume() {
      lastProgress = performance.now()
      if (document.visibilityState === "visible") void attemptPlay("foreground")
    }
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
      report(true)
      frameCallback = video.requestVideoFrameCallback(frame)
    }
    function unavailable() { report(false) }
    function paused() { void attemptPlay("pause") }
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
    // Transient buffering/pauses do not invalidate an already rendered frame.
    // The progress watchdog below handles sustained, visible stalls.
    video.addEventListener("pause", paused)
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
      if (!current() || !stream || document.visibilityState !== "visible") return
      const progressed = hasFrameCallback ? renderedFrames > lastFrames : video.currentTime > lastTime
      if (progressed) { lastProgress = performance.now(); report(true) }
      else if (playbackHasStalled(true, performance.now(), lastProgress)) {
        log("playback not advancing", { paused: video.paused, muted: video.muted })
        report(false)
      }
      lastFrames = renderedFrames
      lastTime = video.currentTime
      if (video.paused) {
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
      video.removeEventListener("pause", paused)
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
      style={phoneFraming === null ? undefined : {
        objectFit: "contain",
        transformOrigin: `50% ${phoneFraming.anchorY}`,
        // Mirroring folds into this transform: Tailwind's -scale-x-100 uses the separate `scale` property and would compound.
        transform: `scale(${mirrored ? -phoneFraming.zoom : phoneFraming.zoom}, ${phoneFraming.zoom})`,
      }}
      className={`h-full w-full object-cover ${mirrored && phoneFraming === null ? "-scale-x-100" : ""} ${className ?? ""}`} />
    {role === "peer" && stream && audioBlocked && <button type="button"
      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); enableAudioRef.current?.() }}>
      Tap to hear
    </button>}
  </>
}
