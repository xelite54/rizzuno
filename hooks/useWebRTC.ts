"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { RtcSignal } from "@/lib/signaling/protocol"

/**
 * Google's public STUN servers are always present as a fallback. A TURN
 * relay is added on top, only if actually configured — without one, two
 * peers behind symmetric NATs or restrictive corporate/mobile-carrier
 * firewalls can fail to establish a direct connection at all (STUN alone
 * can't traverse those; it only helps discover a public address, it can't
 * relay traffic). `NEXT_PUBLIC_TURN_URL` accepts one or several
 * comma-separated URLs (e.g. `turn:host:3478,turns:host:5349`).
 *
 * Credentials are necessarily readable in the shipped browser bundle
 * (`NEXT_PUBLIC_*`) — that's inherent to configuring `RTCPeerConnection`
 * client-side, the same way any TURN client credential has to reach the
 * browser one way or another. For a production deployment at meaningful
 * scale, prefer a TURN provider that supports short-lived, per-session
 * credentials minted by a server endpoint over a long-lived static secret
 * baked into the build (this file doesn't assume which — it just uses
 * whatever's configured, and works with neither at all, falling back to
 * STUN-only, exactly as before).
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL
  if (turnUrl) {
    const urls = turnUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean)
    if (urls.length > 0) {
      const username = process.env.NEXT_PUBLIC_TURN_USERNAME
      const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL
      servers.push({
        urls,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      })
    }
  }
  return servers
}

const ICE_SERVERS: RTCIceServer[] = buildIceServers()

export type PeerConnectionStatus = "new" | "connecting" | "connected" | "failed" | "closed"

type UseWebRTCParams = {
  roomId: string | null
  initiator: boolean
  videoTrack: MediaStreamTrack | null
  audioTrack: MediaStreamTrack | null
  sendSignal: (roomId: string, data: RtcSignal) => void
  onSignal: (handler: (roomId: string, data: RtcSignal) => void) => () => void
}

/**
 * One RTCPeerConnection per room. A video and an audio transceiver are
 * created up front (sendrecv, even before a local track exists), so every
 * camera/mic toggle or device switch afterward is a plain `replaceTrack`
 * call — never a renegotiation — and turning the camera off, back on, or
 * swapping devices mid-call never disrupts the connection.
 */
export function useWebRTC({ roomId, initiator, videoTrack, audioTrack, sendSignal, onSignal }: UseWebRTCParams) {
  const [status, setStatus] = useState<PeerConnectionStatus>("new")
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sendersRef = useRef<{ video: RTCRtpSender | null; audio: RTCRtpSender | null }>({ video: null, audio: null })
  const remoteStream = useMemo(() => (roomId ? new MediaStream() : null), [roomId])

  useEffect(() => {
    if (!roomId || !remoteStream) return

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc
    console.log("webrtc: peer created", { roomId, initiator })
    let remoteDescriptionSet = false
    let pendingCandidates: RTCIceCandidateInit[] = []
    let cancelled = false

    // A brand-new RTCPeerConnection was just created for this room — this is
    // resource initialization, not mirroring some other piece of state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("connecting")

    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" })
    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" })
    sendersRef.current = { video: videoTransceiver.sender, audio: audioTransceiver.sender }
    if (videoTrack) {
      videoTransceiver.sender
        .replaceTrack(videoTrack)
        .catch((err) => console.error("webrtc: replaceTrack (initial video) failed", { roomId, error: String(err) }))
    }
    if (audioTrack) {
      audioTransceiver.sender
        .replaceTrack(audioTrack)
        .catch((err) => console.error("webrtc: replaceTrack (initial audio) failed", { roomId, error: String(err) }))
    }

    pc.ontrack = (event) => {
      if (!remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("webrtc: ICE candidate", { roomId, type: event.candidate.type ?? "unknown" })
        sendSignal(roomId, { kind: "ice", candidate: event.candidate.toJSON() })
      }
    }

    pc.onconnectionstatechange = () => {
      if (cancelled) return
      if (pc.connectionState === "connected") {
        console.log("webrtc: connected", { roomId })
        setStatus("connected")
      } else if (pc.connectionState === "failed") {
        console.error("webrtc: failed", { roomId, iceConnectionState: pc.iceConnectionState })
        pc.restartIce() // spec §55: try to recover before giving up on the call
        setStatus("failed")
      } else if (pc.connectionState === "closed") {
        setStatus("closed")
      }
    }

    async function flushPendingCandidates() {
      const queued = pendingCandidates
      pendingCandidates = []
      for (const candidate of queued) {
        await pc
          .addIceCandidate(candidate)
          .then(() => console.log("webrtc: ice applied (flushed)", { roomId }))
          .catch((err) => {
            console.error("webrtc: addIceCandidate (flushed) failed", { roomId, error: String(err) })
          })
      }
    }

    const unsubscribe = onSignal(async (incomingRoomId, data) => {
      if (incomingRoomId !== roomId) return
      try {
        if (data.kind === "offer") {
          console.log("webrtc: offer received", { roomId })
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp })
          remoteDescriptionSet = true
          await flushPendingCandidates()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          console.log("webrtc: answer created", { roomId })
          sendSignal(roomId, { kind: "answer", sdp: answer.sdp ?? "" })
          console.log("webrtc: answer sent", { roomId })
        } else if (data.kind === "answer") {
          console.log("webrtc: answer received", { roomId })
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
          remoteDescriptionSet = true
          await flushPendingCandidates()
        } else if (data.kind === "ice") {
          if (remoteDescriptionSet) {
            await pc
              .addIceCandidate(data.candidate)
              .then(() => console.log("webrtc: ice applied", { roomId }))
              .catch((err) => {
                console.error("webrtc: addIceCandidate failed", { roomId, error: String(err) })
              })
          } else {
            console.log("webrtc: ice buffered", { roomId })
            pendingCandidates.push(data.candidate)
          }
        }
      } catch (err) {
        // Malformed or out-of-order signaling — safe to ignore, negotiation
        // will retry (or the stuck-connection timeout in
        // useMatchmaking.ts eventually gives up and skips) — but logged
        // rather than silently swallowed, so a real, recurring negotiation
        // problem is actually visible instead of just "calls sometimes
        // don't connect, no idea why."
        console.error("webrtc: signal handling failed", { roomId, kind: data.kind, error: String(err) })
      }
    })

    if (initiator) {
      ;(async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          console.log("webrtc: offer created", { roomId })
          sendSignal(roomId, { kind: "offer", sdp: offer.sdp ?? "" })
        } catch (err) {
          // connectionstatechange will reflect the failure too; logged here
          // as well since createOffer/setLocalDescription failing outright
          // is a different, more specific problem than a negotiation that
          // started and then stalled.
          console.error("webrtc: offer creation failed", { roomId, error: String(err) })
        }
      })()
    }

    return () => {
      cancelled = true
      unsubscribe()
      pc.close()
      pcRef.current = null
      sendersRef.current = { video: null, audio: null }
      setStatus("closed")
    }
    // videoTrack/audioTrack are deliberately excluded: the effect below keeps
    // them in sync via replaceTrack without recreating the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, initiator, remoteStream, sendSignal, onSignal])

  // Swap the outgoing tracks whenever the camera/mic is toggled or a
  // different device is chosen — replaceTrack only, never renegotiation.
  useEffect(() => {
    const { video, audio } = sendersRef.current
    if (video && video.track !== videoTrack) {
      video.replaceTrack(videoTrack).catch((err) => console.error("webrtc: replaceTrack (video) failed", { error: String(err) }))
    }
    if (audio && audio.track !== audioTrack) {
      audio.replaceTrack(audioTrack).catch((err) => console.error("webrtc: replaceTrack (audio) failed", { error: String(err) }))
    }
  }, [videoTrack, audioTrack])

  return { remoteStream, status }
}
