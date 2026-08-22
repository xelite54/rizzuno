"use client"

import { useCallback, useEffect, useState } from "react"

export type MediaPermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable"

const VIDEO_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }

export function useLocalMedia() {
  const [status, setStatus] = useState<MediaPermissionState>("idle")
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
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

  // Camera "off" really releases the hardware — stop() + remove the track,
  // not just enabled = false — so the device's camera indicator light
  // actually goes out. Turning it back on re-acquires a fresh track.
  const toggleCamera = useCallback(async () => {
    if (!stream) return

    if (cameraEnabled) {
      const track = stream.getVideoTracks()[0]
      if (track) {
        stream.removeTrack(track)
        track.stop()
      }
      setVideoTrack(null)
      setCameraEnabled(false)
      return
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS })
      const track = media.getVideoTracks()[0]
      if (!track) return
      stream.addTrack(track)
      setVideoTrack(track)
      setCameraEnabled(true)
    } catch {
      // Camera unavailable or permission revoked — stay off rather than crash.
    }
  }, [stream, cameraEnabled])

  const selectCamera = useCallback(
    async (deviceId: string) => {
      if (!stream) return
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: { exact: deviceId } },
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
        setCameraEnabled(true)
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
    cameraEnabled,
    toggleMic,
    toggleCamera,
    selectCamera,
    selectMic,
  }
}
