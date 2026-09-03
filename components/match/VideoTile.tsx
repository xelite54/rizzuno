"use client"

import { useEffect, useRef } from "react"

type VideoTileProps = {
  stream: MediaStream | null
  muted?: boolean
  mirrored?: boolean
  className?: string
}

// How often to check that a supposedly-playing <video> element's
// currentTime is actually advancing — TEMPORARY, part of the same
// "connected but no remote video renders" investigation as
// hooks/useWebRTC.ts's own stats/ontrack diagnostics (see that file's doc
// comments). This is the one failure mode getStats() alone can never see:
// real, decoded frames that still never reach the element's own rendering.
// Remove alongside those once a real two-device test confirms the fix.
const PLAYBACK_CHECK_INTERVAL_MS = 5000

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
    if (!video) return

    // Concise, TEMPORARY diagnostics for the same investigation as
    // useWebRTC.ts's stats/ontrack logging — together they're what tells
    // apart "no remote packets arriving" (see that file) from "packets
    // decoding fine but this element never actually reaches `playing`"
    // (this file). `label` distinguishes the self tile (always muted, was
    // never actually affected) from the peer tile in the logs without
    // needing this component to know which one it is.
    const label = muted ? "self" : "peer"

    function attemptPlay(reason: string) {
      if (!video || video.paused === false) return
      const playPromise = video.play()
      if (playPromise === undefined) return
      playPromise.catch((err) => {
        console.error("videoTile: autoplay blocked, retrying muted", { label, reason, error: String(err) })
        // A muted play is near-universally allowed even where starting
        // unmuted from a standstill wasn't — this is what actually makes
        // the picture itself show up. Restoring the originally intended
        // muted state right after usually succeeds too: the gesture-gated
        // restriction applies to STARTING playback with audio, not to
        // unmuting media that's already playing.
        if (!video) return
        video.muted = true
        video
          .play()
          .then(() => {
            if (video && !muted) video.muted = false
          })
          .catch((err2) => {
            console.error("videoTile: muted autoplay retry also failed", { label, error: String(err2) })
          })
      })
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream
      console.log("videoTile: srcObject set", {
        label,
        hasStream: Boolean(stream),
        trackKinds: stream?.getTracks().map((t) => t.kind) ?? [],
      })
    }
    if (!stream) return

    attemptPlay("initial")

    // `autoPlay`/the immediate attempt above can both fire before the
    // element actually has real data — re-attempting on these events
    // catches the case where playback needs a nudge again once metadata/
    // enough data has genuinely arrived, not just once at srcObject-assignment
    // time. All of these (loadedmetadata/canplay/playing/waiting/stalled)
    // are logged, concisely, as exactly the trail needed to tell "reached
    // playing" apart from "stuck at readyState X" from the console alone.
    function onLoadedMetadata() {
      console.log("videoTile: loadedmetadata", { label, videoWidth: video?.videoWidth, videoHeight: video?.videoHeight })
      attemptPlay("loadedmetadata")
    }
    function onCanPlay() {
      console.log("videoTile: canplay", { label, readyState: video?.readyState })
      attemptPlay("canplay")
    }
    function onPlaying() {
      console.log("videoTile: playing", { label, videoWidth: video?.videoWidth, videoHeight: video?.videoHeight })
    }
    function onWaiting() {
      console.log("videoTile: waiting (stalled buffering)", { label })
    }
    function onStalled() {
      console.log("videoTile: stalled (no data arriving)", { label })
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata)
    video.addEventListener("canplay", onCanPlay)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("waiting", onWaiting)
    video.addEventListener("stalled", onStalled)

    // The video TRACK's own "unmute" (WebRTC's "real data just started
    // arriving for this track" signal, not the UI mic-mute concept) is a
    // distinct moment from any of the <video> ELEMENT events above — a
    // track can exist and be attached well before it's actually live,
    // exactly the gap a first play() attempt can land in and fail/no-op
    // without ever getting a second real chance once data does start.
    const tracks = stream.getTracks()
    const trackUnmuteHandlers = tracks.map((track) => {
      const onTrackUnmute = () => attemptPlay(`track-unmuted:${track.kind}`)
      track.addEventListener("unmute", onTrackUnmute)
      return { track, onTrackUnmute }
    })

    // Distinguishes "reached `playing`, decoding real frames, but visibly
    // frozen" from a genuinely healthy element — readyState/paused alone
    // can both look fine on a stream that stopped actually advancing.
    let lastCheckedTime = video.currentTime
    const playbackCheck = setInterval(() => {
      if (!video) return
      if (!video.paused && video.currentTime === lastCheckedTime) {
        console.error("videoTile: currentTime hasn't advanced since the last check — playback may be stalled", {
          label,
          readyState: video.readyState,
          currentTime: video.currentTime,
        })
      }
      lastCheckedTime = video.currentTime
    }, PLAYBACK_CHECK_INTERVAL_MS)

    return () => {
      clearInterval(playbackCheck)
      video.removeEventListener("loadedmetadata", onLoadedMetadata)
      video.removeEventListener("canplay", onCanPlay)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("waiting", onWaiting)
      video.removeEventListener("stalled", onStalled)
      for (const { track, onTrackUnmute } of trackUnmuteHandlers) {
        track.removeEventListener("unmute", onTrackUnmute)
      }
    }
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
