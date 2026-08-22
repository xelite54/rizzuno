"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { RtcSignal } from "@/lib/signaling/protocol"

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

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
    if (videoTrack) videoTransceiver.sender.replaceTrack(videoTrack).catch(() => {})
    if (audioTrack) audioTransceiver.sender.replaceTrack(audioTrack).catch(() => {})

    pc.ontrack = (event) => {
      if (!remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(roomId, { kind: "ice", candidate: event.candidate.toJSON() })
      }
    }

    pc.onconnectionstatechange = () => {
      if (cancelled) return
      if (pc.connectionState === "connected") setStatus("connected")
      else if (pc.connectionState === "failed") {
        pc.restartIce() // spec §55: try to recover before giving up on the call
        setStatus("failed")
      } else if (pc.connectionState === "closed") setStatus("closed")
    }

    async function flushPendingCandidates() {
      const queued = pendingCandidates
      pendingCandidates = []
      for (const candidate of queued) {
        await pc.addIceCandidate(candidate).catch(() => {})
      }
    }

    const unsubscribe = onSignal(async (incomingRoomId, data) => {
      if (incomingRoomId !== roomId) return
      try {
        if (data.kind === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp })
          remoteDescriptionSet = true
          await flushPendingCandidates()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendSignal(roomId, { kind: "answer", sdp: answer.sdp ?? "" })
        } else if (data.kind === "answer") {
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
          remoteDescriptionSet = true
          await flushPendingCandidates()
        } else if (data.kind === "ice") {
          if (remoteDescriptionSet) {
            await pc.addIceCandidate(data.candidate).catch(() => {})
          } else {
            pendingCandidates.push(data.candidate)
          }
        }
      } catch {
        // Malformed or out-of-order signaling — safe to ignore, negotiation will retry.
      }
    })

    if (initiator) {
      ;(async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendSignal(roomId, { kind: "offer", sdp: offer.sdp ?? "" })
        } catch {
          // connectionstatechange will reflect the failure
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
    if (video && video.track !== videoTrack) video.replaceTrack(videoTrack).catch(() => {})
    if (audio && audio.track !== audioTrack) audio.replaceTrack(audioTrack).catch(() => {})
  }, [videoTrack, audioTrack])

  return { remoteStream, status }
}
