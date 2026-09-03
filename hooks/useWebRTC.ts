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
    const urls = sortUdpFirst(
      turnUrl
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
    )
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

/**
 * Orders a TURN url list so UDP-capable entries (`turn:` without an
 * explicit `?transport=tcp`) come before TCP-forced ones (`turns:`, or any
 * `turn:` url with `?transport=tcp`) — UDP has meaningfully lower latency
 * for realtime media than a TCP/TLS relay, so if the browser has a real
 * choice between reachable candidates, this gives it a UDP one first.
 * This is ordering, not exclusion: every url configured is still included
 * and still eligible — nothing here forces TURN or a specific transport,
 * and a network that only allows the TCP path still gets it, just later
 * in the list ICE gathers from.
 */
// Exported for tests/webrtcHelpers.test.mts only — everything else in this
// file needs a real browser to exercise (RTCPeerConnection, getUserMedia),
// but this specific ordering logic is pure and worth pinning down directly.
export function sortUdpFirst(urls: string[]): string[] {
  const isTcpForced = (url: string) => url.startsWith("turns:") || /[?&]transport=tcp\b/i.test(url)
  return [...urls].sort((a, b) => Number(isTcpForced(a)) - Number(isTcpForced(b)))
}

const ICE_SERVERS: RTCIceServer[] = buildIceServers()

// A realistic ceiling for 720p30 realtime video — high enough for a sharp
// picture on a good connection, low enough to stay a genuinely reasonable
// "always fine" default rather than something that only behaves on a great
// network. This is a MAX, not a target: WebRTC's own congestion control
// (bandwidth estimation via RTCP/TWCC feedback) still reduces the actual
// send rate — and, via `degradationPreference` below, resolution or
// framerate too — well below this the moment the network can't sustain it.
// Setting this ceiling doesn't disable or fight that; it just stops the
// encoder from using dramatically more bandwidth than a 720p call needs
// even when the network technically has it to spare.
const MAX_VIDEO_BITRATE_BPS = 2_500_000
const MAX_VIDEO_FRAMERATE = 30

/**
 * Applies a sensible 720p realtime ceiling to the outgoing video sender —
 * called once, right after the video transceiver/sender is created, not
 * re-applied on every camera toggle or device switch (replaceTrack doesn't
 * reset a sender's already-set encoding parameters, so there's nothing to
 * redo there). `degradationPreference: "balanced"` is set explicitly
 * (rather than left as an unstated default) so it's clear in code that
 * congestion control is deliberately free to trade EITHER resolution or
 * framerate down under real network pressure — never pinned to
 * "maintain-resolution"/"maintain-framerate", either of which would defeat
 * the point of leaving congestion control room to work.
 */
async function configureVideoEncoding(sender: RTCRtpSender) {
  try {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
    params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE_BPS
    params.encodings[0].maxFramerate = MAX_VIDEO_FRAMERATE
    params.degradationPreference = "balanced"
    await sender.setParameters(params)
  } catch (err) {
    // Non-fatal — the call still works with whatever the browser's own
    // defaults are; this is a quality tuning, not a correctness dependency.
    console.error("webrtc: failed to configure video encoding parameters", { error: String(err) })
  }
}

// How often to sample getStats() during a call — frequent enough to
// actually see a quality problem develop, infrequent enough to stay
// "lightweight" (a handful of log lines a minute, not a firehose).
const STATS_INTERVAL_MS = 5000

/**
 * Logs one compact line of connection/media-quality diagnostics — the
 * selected ICE candidate pair's type (host/srflx/relay) and transport
 * (udp/tcp), round-trip time, the OUTGOING video's packet loss (as the
 * remote side actually reports it back via RTCP receiver reports),
 * bitrate (derived from the delta in `bytesSent` between polls — getStats
 * only ever reports a cumulative counter, never a rate directly), and the
 * real, currently-transmitted frame rate/resolution (which can be lower
 * than the camera's own capture settings the moment congestion control
 * scales either down).
 *
 * NEVER logs a candidate's address/port, `relatedAddress`, or any TURN
 * credential — only `candidateType` and `protocol`, which reveal nothing
 * about either peer's real IP. Silently does nothing before the call is
 * actually connected — half-populated stats from mid-negotiation aren't
 * useful call-quality diagnostics, just noise.
 */
function makeStatsLogger(pc: RTCPeerConnection, roomId: string) {
  let lastOutboundVideoBytes: number | null = null
  let lastOutboundVideoTimestamp: number | null = null

  return async function logStats() {
    if (pc.connectionState !== "connected") return
    let report: RTCStatsReport
    try {
      report = await pc.getStats()
    } catch (err) {
      console.error("webrtc: stats collection failed", { roomId, error: String(err) })
      return
    }

    let candidateType: string | null = null
    let transportProtocol: string | null = null
    let rttMs: number | null = null
    let selectedPairId: string | null = null

    report.forEach((stat) => {
      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
        selectedPairId = stat.selectedCandidatePairId
      }
    })
    if (!selectedPairId) {
      report.forEach((stat) => {
        if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") {
          selectedPairId = stat.id
        }
      })
    }
    if (selectedPairId) {
      const pair = report.get(selectedPairId)
      if (pair) {
        if (typeof pair.currentRoundTripTime === "number") rttMs = Math.round(pair.currentRoundTripTime * 1000)
        const local = typeof pair.localCandidateId === "string" ? report.get(pair.localCandidateId) : undefined
        if (local?.type === "local-candidate") {
          candidateType = typeof local.candidateType === "string" ? local.candidateType : null
          transportProtocol = typeof local.protocol === "string" ? local.protocol : null
        }
      }
    }

    let packetsLost: number | null = null
    let fractionLost: number | null = null
    let outgoingBitrateKbps: number | null = null
    let framesPerSecond: number | null = null
    let resolution: string | null = null

    report.forEach((stat) => {
      if (stat.type === "outbound-rtp" && stat.kind === "video") {
        framesPerSecond = typeof stat.framesPerSecond === "number" ? Math.round(stat.framesPerSecond) : null
        resolution =
          typeof stat.frameWidth === "number" && typeof stat.frameHeight === "number"
            ? `${stat.frameWidth}x${stat.frameHeight}`
            : null
        if (typeof stat.bytesSent === "number" && typeof stat.timestamp === "number") {
          if (lastOutboundVideoBytes !== null && lastOutboundVideoTimestamp !== null) {
            const bytesDelta = stat.bytesSent - lastOutboundVideoBytes
            const msDelta = stat.timestamp - lastOutboundVideoTimestamp
            if (msDelta > 0) outgoingBitrateKbps = Math.round((bytesDelta * 8) / msDelta)
          }
          lastOutboundVideoBytes = stat.bytesSent
          lastOutboundVideoTimestamp = stat.timestamp
        }
      }
      if (stat.type === "remote-inbound-rtp" && stat.kind === "video") {
        packetsLost = typeof stat.packetsLost === "number" ? stat.packetsLost : null
        fractionLost = typeof stat.fractionLost === "number" ? Math.round(stat.fractionLost * 1000) / 1000 : null
        if (rttMs === null && typeof stat.roundTripTime === "number") rttMs = Math.round(stat.roundTripTime * 1000)
      }
    })

    console.log("webrtc: stats", {
      roomId,
      candidateType,
      transportProtocol,
      rttMs,
      packetsLost,
      fractionLost,
      outgoingBitrateKbps,
      framesPerSecond,
      resolution,
    })
  }
}

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

    // Explicit, not just the implicit default — "all" (never "relay")
    // means every candidate type is gathered and ICE's own priority
    // ordering (RFC 8445: host/srflx always outrank relay by type alone,
    // independent of anything below) is what actually picks a direct
    // path over TURN whenever one exists. TURN only ever gets used when
    // it's the only pair that actually connects — this is what makes it a
    // genuine fallback rather than a forced relay.
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: "all" })
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
    configureVideoEncoding(videoTransceiver.sender)
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

    // Lightweight call-quality diagnostics — see makeStatsLogger's own doc
    // comment for exactly what's collected (and, just as deliberately,
    // what never is: no address/port/credential ever leaves this function).
    // Cleared below alongside everything else the moment this room ends —
    // a fresh interval starts for whatever room (if any) comes next.
    const statsLogger = makeStatsLogger(pc, roomId)
    const statsInterval = setInterval(statsLogger, STATS_INTERVAL_MS)

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
      clearInterval(statsInterval)
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
