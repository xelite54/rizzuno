"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

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

type CaptureOwner = {
  disposed: boolean
  video: MediaStreamTrack | null
  audio: MediaStreamTrack | null
  videoRequest: number
  audioRequest: number
  videoPending: boolean
  audioPending: boolean
}

export function useLocalMedia() {
  const [status, setStatus] = useState<MediaPermissionState>("idle")
  const [micEnabled, setMicEnabled] = useState(true)
  const micRef = useRef(micEnabled)
  const ownerRef = useRef<CaptureOwner | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const videoTrack = localStream?.getVideoTracks()[0] ?? null
  const audioTrack = localStream?.getAudioTracks()[0] ?? null
  useLayoutEffect(() => {
    micRef.current = micEnabled
    if (ownerRef.current?.audio) ownerRef.current.audio.enabled = micEnabled
  }, [micEnabled])

  const acquire = useCallback(async (owner: CaptureOwner, video: MediaTrackConstraints | false, audio: MediaTrackConstraints | boolean) => {
    if (owner.disposed || !navigator.mediaDevices?.getUserMedia) return
    const videoRequest = video ? ++owner.videoRequest : owner.videoRequest
    const audioRequest = audio ? ++owner.audioRequest : owner.audioRequest
    if (video) owner.videoPending = true
    if (audio) owner.audioPending = true
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ video, audio })
      const retired: MediaStreamTrack[] = []
      for (const track of acquired.getTracks()) {
        const kind = track.kind === "video" ? "video" : "audio"
        const currentRequest = kind === "video" ? videoRequest === owner.videoRequest : audioRequest === owner.audioRequest
        if (owner.disposed || ownerRef.current !== owner || !currentRequest || track.readyState !== "live") {
          track.stop()
          continue
        }
        if (kind === "audio") track.enabled = micRef.current
        if (owner[kind]) retired.push(owner[kind])
        owner[kind] = track
      }
      if (owner.disposed || ownerRef.current !== owner) return
      // Publish a new stream snapshot on every capture change. Self preview
      // and room sender now read the same exact live track objects.
      setLocalStream(new MediaStream([owner.video, owner.audio].filter((track): track is MediaStreamTrack => Boolean(track))))
      setStatus(owner.video?.readyState === "live" ? "granted" : "unavailable")
      retired.forEach(track => track.stop())
      console.log("localMedia: capture updated", {
        videoReadyState: owner.video?.readyState ?? null,
        videoEnabled: owner.video?.enabled ?? false,
        audioReadyState: owner.audio?.readyState ?? null,
      })
    } catch {
      if (!owner.disposed && ownerRef.current === owner && owner.video?.readyState !== "live") setStatus("denied")
    } finally {
      if (video && videoRequest === owner.videoRequest) owner.videoPending = false
      if (audio && audioRequest === owner.audioRequest) owner.audioPending = false
    }
  }, [])

  useEffect(() => {
    const owner: CaptureOwner = { disposed: false, video: null, audio: null, videoRequest: 0, audioRequest: 0, videoPending: false, audioPending: false }
    ownerRef.current = owner
    // eslint-disable-next-line react-hooks/set-state-in-effect -- acquiring an external camera/microphone resource
    setStatus(typeof navigator.mediaDevices?.getUserMedia === "function" ? "requesting" : "unavailable")
    void acquire(owner, VIDEO_CONSTRAINTS, true)
    const resume = () => {
      if (document.visibilityState !== "visible") return
      const videoDead = !owner.videoPending && owner.video?.readyState !== "live"
      const audioDead = !owner.audioPending && owner.audio?.readyState !== "live"
      if (videoDead || audioDead) void acquire(owner, videoDead ? VIDEO_CONSTRAINTS : false, audioDead)
    }
    document.addEventListener("visibilitychange", resume)
    return () => {
      owner.disposed = true
      document.removeEventListener("visibilitychange", resume)
      owner.video?.stop()
      owner.audio?.stop()
      if (ownerRef.current === owner) ownerRef.current = null
    }
  }, [acquire])

  useEffect(() => {
    if (!videoTrack) return
    const ended = () => setStatus("unavailable")
    videoTrack.addEventListener("ended", ended)
    return () => videoTrack.removeEventListener("ended", ended)
  }, [videoTrack])
  const toggleMic = useCallback(() => setMicEnabled(previous => !previous), [])
  const selectCamera = useCallback(async (deviceId: string) => {
    const owner = ownerRef.current
    if (owner) await acquire(owner, { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } }, false)
  }, [acquire])
  const selectMic = useCallback(async (deviceId: string) => {
    const owner = ownerRef.current
    if (owner) await acquire(owner, false, { deviceId: { exact: deviceId } })
  }, [acquire])
  return { localStream, videoTrack, audioTrack, status, micEnabled, toggleMic, selectCamera, selectMic }
}
