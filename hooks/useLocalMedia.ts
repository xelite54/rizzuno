"use client"

import { useCallback, useEffect, useState } from "react"

export type MediaPermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable"

// 720p, not 1080p, as the default target for random 1:1 chat — a face
// fills most of the frame in these panels either way, and 1080p's extra
// detail was mostly spent on slower startup, more packet loss on marginal
// networks, more TURN relay bandwidth when relaying is needed, and more
// CPU/battery on mobile, for very little perceptible clarity gain at this
// framing. Dimensions are ideals, not requirements — a camera that can't
// do 720p still works, and one capable of more is still allowed to send
// less under real network pressure (this is capture, not an encoder cap —
// see MAX_VIDEO_BITRATE_BPS in useWebRTC.ts for that). Keep 30fps as the
// ceiling to limit capture/encoding cost; the outgoing encoder remains
// free to reduce resolution and frame rate further under congestion
// (degradationPreference: "balanced", also in useWebRTC.ts).
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: "user",
}

export function useLocalMedia() {
  const [status, setStatus] = useState<MediaPermissionState>("idle")
  const [micEnabled, setMicEnabled] = useState(true)
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null)
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null)

  // Starts null — identical on the server and on the client's first render.
  // `MediaStream` doesn't exist on the server, so constructing it during
  // render (even lazily) would return something on the client's first pass
  // that the server never produced, which is a hydration mismatch. It's
  // created inside the effect below instead, strictly after hydration.
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    const media = new MediaStream()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging server/client environments, not mirroring existing state
    setStream(media)

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable")
        return
      }
      setStatus("requesting")
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: true })
        if (cancelled) {
          acquired.getTracks().forEach((track) => track.stop())
          return
        }
        acquired.getTracks().forEach((track) => media.addTrack(track))
        setVideoTrack(acquired.getVideoTracks()[0] ?? null)
        setAudioTrack(acquired.getAudioTracks()[0] ?? null)
        setStatus("granted")
      } catch {
        if (!cancelled) setStatus("denied")
      }
    }

    start()

    return () => {
      cancelled = true
      media.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // The actual mute — kept as its own effect (not mutated inline inside the
  // state updater below) so it re-applies no matter *why* the audio track
  // changed: toggling, switching microphones, or the initial grant — one
  // place guarantees the track's real enabled state always matches what the
  // UI says, instead of each call site having to remember to set it.
  useEffect(() => {
    if (!stream || !audioTrack) return
    // Mutate the track via the stream's own accessor, not the `audioTrack`
    // state binding directly — same underlying MediaStreamTrack, but this is
    // how the browser API expects it to be muted (there's no "setter" for a
    // native track's enabled flag).
    stream.getAudioTracks().forEach((track) => {
      track.enabled = micEnabled
    })
  }, [stream, audioTrack, micEnabled])

  const toggleMic = useCallback(() => {
    setMicEnabled((prev) => !prev)
  }, [])

  // Hardware disconnection or revoked permission still invalidates capture.
  useEffect(() => {
    if (!videoTrack) return
    const ended = () => { setVideoTrack(null); setStatus("unavailable") }
    videoTrack.addEventListener("ended", ended)
    return () => videoTrack.removeEventListener("ended", ended)
  }, [videoTrack])

  // Mobile OSes can suspend or fully kill camera/mic capture while a tab
  // is backgrounded — a screen lock, switching apps, an extended
  // background period — sometimes cleanly (the track's own "ended" event
  // above already covers that, live or backgrounded alike), sometimes
  // silently, with nothing observable until the track is actually touched
  // again. Checking on regaining visibility is what catches the silent
  // case, and is also what lets "permission denied, then enabled in
  // browser settings while the tab was backgrounded" recover on its own
  // instead of requiring a manual reload — a plain retry after a denial
  // triggers no repeated system prompt either way, so there's nothing to
  // lose by trying.
  //
  // Reuses the existing track (does nothing at all) whenever it's still
  // genuinely live — reacquiring unconditionally on every foreground
  // return would create a second, redundant MediaStream/track pair for
  // the overwhelmingly common case where nothing actually died, which is
  // exactly the duplicate-tracks outcome this must avoid. Skipped
  // entirely while the very first acquisition is still in flight
  // (`status === "requesting"`) so this can never race that initial call.
  useEffect(() => {
    async function handleVisibility() {
      if (document.visibilityState !== "visible") return
      if (!stream || status === "requesting") return
      if (!navigator.mediaDevices?.getUserMedia) return
      const videoDead = !videoTrack || videoTrack.readyState === "ended"
      const audioDead = !audioTrack || audioTrack.readyState === "ended"
      if (!videoDead && !audioDead) return
      console.log("useLocalMedia: reacquiring on resume — a track was found dead", { videoDead, audioDead })
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: videoDead ? VIDEO_CONSTRAINTS : false,
          audio: audioDead,
        })
        if (videoDead) {
          const track = acquired.getVideoTracks()[0]
          if (track) {
            const old = stream.getVideoTracks()[0]
            if (old) { stream.removeTrack(old); old.stop() }
            stream.addTrack(track)
            setVideoTrack(track)
          }
        }
        if (audioDead) {
          const track = acquired.getAudioTracks()[0]
          if (track) {
            const old = stream.getAudioTracks()[0]
            if (old) { stream.removeTrack(old); old.stop() }
            stream.addTrack(track)
            setAudioTrack(track)
          }
        }
        setStatus("granted")
      } catch {
        // Still can't capture (hardware busy, still denied, ...) — leave
        // existing state exactly as it was; no worse off than before the
        // attempt, and the next visibility change tries again.
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [stream, videoTrack, audioTrack, status])

  const selectCamera = useCallback(
    async (deviceId: string) => {
      if (!stream) return
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } },
        })
        const track = media.getVideoTracks()[0]
        if (!track) return
        const old = stream.getVideoTracks()[0]
        if (old) {
          stream.removeTrack(old)
          old.stop()
        }
        stream.addTrack(track)
        setVideoTrack(track)
        setStatus("granted")
      } catch {
        // Keep the previous camera if switching fails.
      }
    },
    [stream]
  )

  const selectMic = useCallback(
    async (deviceId: string) => {
      if (!stream) return
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })
        const track = media.getAudioTracks()[0]
        if (!track) return
        // Its enabled state gets synced by the effect above once setAudioTrack fires below.
        const old = stream.getAudioTracks()[0]
        if (old) {
          stream.removeTrack(old)
          old.stop()
        }
        stream.addTrack(track)
        setAudioTrack(track)
      } catch {
        // Keep the previous microphone if switching fails.
      }
    },
    [stream]
  )

  return {
    stream,
    videoTrack,
    audioTrack,
    status,
    micEnabled,
    toggleMic,
    selectCamera,
    selectMic,
  }
}
