"use client"

import { useEffect, useRef, useState } from "react"
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

// A single tick drives three things at once: readiness detection (fast
// enough that "connected" -> real video showing up doesn't feel laggy),
// the media-recovery timeout below, and sender self-healing. Full
// diagnostic logging is throttled to every 5th tick (see LOG_EVERY_N_TICKS)
// so it stays "a handful of log lines" at roughly the previous ~5s cadence,
// not a firehose, while readiness/timeout checks themselves stay responsive.
const TICK_INTERVAL_MS = 1000
const LOG_EVERY_N_TICKS = 5

// How long a connection is allowed to sit at connectionState "connected"
// with zero decoded remote video frames before this is treated as a real
// media failure (not just "still negotiating") and recovery is attempted —
// see the room effect's own tick function for exactly what "recovery"
// means here (an ICE restart, and reporting `status: "failed"` so
// useMatchmaking.ts's existing stuck-connection handling — the same path a
// real connectionState "failed" already goes through — takes over from
// there; no new recovery machinery needed beyond what already exists).
const MEDIA_READY_TIMEOUT_MS = 12_000

type CollectedStats = {
  candidateType: string | null
  transportProtocol: string | null
  rttMs: number | null
  outgoing: {
    packetsLost: number | null
    fractionLost: number | null
    bitrateKbps: number | null
    framesPerSecond: number | null
    framesSent: number | null
    resolution: string | null
  }
  incoming: {
    bytesReceived: number | null
    packetsReceived: number | null
    framesReceived: number | null
    framesDecoded: number | null
    bitrateKbps: number | null
    framesPerSecond: number | null
    resolution: string | null
  }
}

/**
 * Parses one getStats() report into the numbers this file actually needs —
 * the selected ICE candidate pair's type (host/srflx/relay) and transport
 * (udp/tcp), round-trip time, both directions' video packet/frame/byte
 * counters, and bitrate (derived from the delta in `bytesSent`/
 * `bytesReceived` between calls — getStats only ever reports a cumulative
 * counter, never a rate directly).
 *
 * TEMPORARY, for diagnosing/verifying the "connected but no remote video
 * renders" investigation — the inbound half in particular
 * (bytesReceived/framesReceived/framesDecoded) is what lets these be told
 * apart: no packets arriving at all (bytesReceived never grows) vs.
 * packets arriving but nothing decoding (bytesReceived grows,
 * framesDecoded doesn't) vs. real decoded frames that still never reach
 * the `<video>` element's own `playing` state (framesDecoded grows — see
 * VideoTile.tsx's own diagnostics for that last piece, which getStats()
 * alone can't see). The outbound `framesSent` field is the matching check
 * for the OTHER direction: confirms this side's own camera track is
 * actually being encoded and sent, not just handed to the sender.
 * `framesDecoded` specifically also drives remoteVideoReady below — not
 * just logged, actually load-bearing.
 *
 * NEVER returns a candidate's address/port, `relatedAddress`, or any TURN
 * credential — only `candidateType` and `protocol`, which reveal nothing
 * about either peer's real IP.
 */
function makeStatsCollector(pc: RTCPeerConnection) {
  let lastOutboundVideoBytes: number | null = null
  let lastOutboundVideoTimestamp: number | null = null
  let lastInboundVideoBytes: number | null = null
  let lastInboundVideoTimestamp: number | null = null

  return async function collectStats(): Promise<CollectedStats | null> {
    if (pc.connectionState !== "connected") return null
    let report: RTCStatsReport
    try {
      report = await pc.getStats()
    } catch {
      return null
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
    let framesSent: number | null = null
    let resolution: string | null = null

    let inboundBytesReceived: number | null = null
    let inboundPacketsReceived: number | null = null
    let framesReceived: number | null = null
    let framesDecoded: number | null = null
    let inboundFramesPerSecond: number | null = null
    let inboundResolution: string | null = null
    let incomingBitrateKbps: number | null = null

    report.forEach((stat) => {
      if (stat.type === "outbound-rtp" && stat.kind === "video") {
        framesPerSecond = typeof stat.framesPerSecond === "number" ? Math.round(stat.framesPerSecond) : null
        framesSent = typeof stat.framesSent === "number" ? stat.framesSent : null
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
      if (stat.type === "inbound-rtp" && stat.kind === "video") {
        inboundBytesReceived = typeof stat.bytesReceived === "number" ? stat.bytesReceived : null
        inboundPacketsReceived = typeof stat.packetsReceived === "number" ? stat.packetsReceived : null
        framesReceived = typeof stat.framesReceived === "number" ? stat.framesReceived : null
        framesDecoded = typeof stat.framesDecoded === "number" ? stat.framesDecoded : null
        inboundFramesPerSecond = typeof stat.framesPerSecond === "number" ? Math.round(stat.framesPerSecond) : null
        inboundResolution =
          typeof stat.frameWidth === "number" && typeof stat.frameHeight === "number"
            ? `${stat.frameWidth}x${stat.frameHeight}`
            : null
        if (typeof stat.bytesReceived === "number" && typeof stat.timestamp === "number") {
          if (lastInboundVideoBytes !== null && lastInboundVideoTimestamp !== null) {
            const bytesDelta = stat.bytesReceived - lastInboundVideoBytes
            const msDelta = stat.timestamp - lastInboundVideoTimestamp
            if (msDelta > 0) incomingBitrateKbps = Math.round((bytesDelta * 8) / msDelta)
          }
          lastInboundVideoBytes = stat.bytesReceived
          lastInboundVideoTimestamp = stat.timestamp
        }
      }
    })

    return {
      candidateType,
      transportProtocol,
      rttMs,
      outgoing: { packetsLost, fractionLost, bitrateKbps: outgoingBitrateKbps, framesPerSecond, framesSent, resolution },
      incoming: {
        bytesReceived: inboundBytesReceived,
        packetsReceived: inboundPacketsReceived,
        framesReceived,
        framesDecoded,
        bitrateKbps: incomingBitrateKbps,
        framesPerSecond: inboundFramesPerSecond,
        resolution: inboundResolution,
      },
    }
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
  // Mirrors the latest videoTrack/audioTrack props for the room effect's own
  // closure to read without needing them in its dependency array (which
  // would tear down and recreate the whole RTCPeerConnection on every
  // camera toggle — see that effect's own trailing comment). Kept current
  // by the replaceTrack-syncing effect further down.
  const videoTrackRef = useRef<MediaStreamTrack | null>(videoTrack)
  const audioTrackRef = useRef<MediaStreamTrack | null>(audioTrack)
  // Starts null, not an eagerly-created empty MediaStream — see the
  // ontrack handler below for why: attaching an always-present-but-empty
  // stream to <video> up front, then mutating it as tracks trickle in, is
  // exactly the pattern that made it easy to believe "the video element
  // has a stream" while it might still have zero actual tracks. null here
  // means exactly what it says: no remote media has arrived yet.
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  // True only once a live remote VIDEO track has arrived AND getStats()
  // confirms real frames are actually being decoded — never just "ICE/DTLS
  // says connected". This is what useMatchmaking.ts's `state` derivation
  // now gates "active" on, instead of `status === "connected"` alone (see
  // that file) — the whole point being that the matched-profile UI never
  // shows over what would otherwise be an empty peer tile.
  const [remoteVideoReady, setRemoteVideoReady] = useState(false)

  useEffect(() => {
    if (!roomId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh room starts with neither known yet, same as `status` below
    setRemoteStream(null)
    setRemoteVideoReady(false)

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
    setStatus("connecting")

    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" })
    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" })
    sendersRef.current = { video: videoTransceiver.sender, audio: audioTransceiver.sender }
    configureVideoEncoding(videoTransceiver.sender)

    // Groups both senders under one explicit local stream (their own msid)
    // as a courtesy to the far side's own negotiation — still correct and
    // worth doing even though this end no longer DEPENDS on it (see
    // pc.ontrack below, which merges into its own persistent stream
    // regardless of how the far side grouped anything). sender.setStreams
    // is a relatively recent addition (not in every browser) — called
    // defensively; nothing here depends on it succeeding.
    try {
      const localGroupStream = new MediaStream()
      videoTransceiver.sender.setStreams?.(localGroupStream)
      audioTransceiver.sender.setStreams?.(localGroupStream)
    } catch (err) {
      console.error("webrtc: sender.setStreams failed (non-fatal — remote grouping doesn't depend on it)", {
        roomId,
        error: String(err),
      })
    }

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

    // ONE persistent MediaStream for this room's entire lifetime — the
    // object VideoTile's srcObject actually binds to, exactly once. Never
    // replaced by whatever `event.streams[0]` happens to be on a given
    // ontrack call: if that ever differs between the video and audio
    // track's own ontrack firing (setStreams() above only partially
    // landing, an older browser, a renegotiation producing a new track),
    // naively swapping the active stream to match would silently drop
    // whichever track this side already had. Instead, every real track
    // that ever arrives gets merged into THIS stream — genuinely correct
    // regardless of how (or whether) the far side grouped anything.
    const combinedRemoteStream = new MediaStream()
    let remoteStreamAttached = false
    let remoteVideoTrackLive = false

    function markVideoNotReady(reason: string) {
      remoteVideoTrackLive = false
      console.log("webrtc: remote video no longer ready", { roomId, reason })
      setRemoteVideoReady(false)
    }

    pc.ontrack = (event) => {
      const track = event.track
      // TEMPORARY diagnostic — see makeStatsCollector's own doc comment
      // for the broader "connected but no video renders" investigation
      // this is part of. `track.muted` here is WebRTC's own "no RTP data
      // is currently arriving for this track" signal (distinct from the
      // UI's mic-mute concept) — false at ontrack time is a good sign
      // real packets are already flowing; true means the track exists but
      // nothing has been received for it yet.
      console.log("webrtc: ontrack fired", {
        roomId,
        kind: track.kind,
        readyState: track.readyState,
        muted: track.muted,
        negotiatedStreamTrackCount: event.streams[0]?.getTracks().length ?? 0,
      })

      // Merge into the persistent stream — replace any STALE track of the
      // same kind first (a renegotiation/ICE-restart producing a new
      // track for an existing kind), never just accumulate duplicates.
      for (const existing of track.kind === "video" ? combinedRemoteStream.getVideoTracks() : combinedRemoteStream.getAudioTracks()) {
        if (existing !== track) combinedRemoteStream.removeTrack(existing)
      }
      if (!combinedRemoteStream.getTracks().includes(track)) {
        combinedRemoteStream.addTrack(track)
      }

      if (track.kind === "video") {
        remoteVideoTrackLive = track.readyState === "live"
        // Confirms the actual MediaStream object VideoTile will receive
        // really does contain this video track — not just that ontrack
        // fired, which on its own doesn't guarantee the merge above
        // landed correctly.
        console.log("webrtc: combined remote stream now has a video track", {
          roomId,
          videoTrackCount: combinedRemoteStream.getVideoTracks().length,
          audioTrackCount: combinedRemoteStream.getAudioTracks().length,
        })
      }

      track.onended = () => {
        console.log("webrtc: remote track ended", { roomId, kind: track.kind })
        if (track.kind === "video") markVideoNotReady("track ended")
      }
      track.onmute = () => {
        console.log("webrtc: remote track muted (no data arriving)", { roomId, kind: track.kind })
        if (track.kind === "video") remoteVideoTrackLive = false
      }
      track.onunmute = () => {
        console.log("webrtc: remote track unmuted (data flowing)", { roomId, kind: track.kind })
        if (track.kind === "video") remoteVideoTrackLive = true
      }

      if (!remoteStreamAttached) {
        remoteStreamAttached = true
        setRemoteStream(combinedRemoteStream)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("webrtc: ICE candidate", { roomId, type: event.candidate.type ?? "unknown" })
        sendSignal(roomId, { kind: "ice", candidate: event.candidate.toJSON() })
      }
    }

    // Tracks how long this connection has been "connected" per ICE/DTLS —
    // the media-readiness timeout below measures from here, independent of
    // (and deliberately more skeptical than) this connectionState alone.
    let connectedAt: number | null = null
    let mediaRecoveryAttempted = false

    pc.onconnectionstatechange = () => {
      if (cancelled) return
      if (pc.connectionState === "connected") {
        console.log("webrtc: connected", { roomId })
        setStatus("connected")
        connectedAt = Date.now()
        mediaRecoveryAttempted = false
      } else if (pc.connectionState === "failed") {
        console.error("webrtc: failed", { roomId, iceConnectionState: pc.iceConnectionState })
        pc.restartIce() // spec §55: try to recover before giving up on the call
        setStatus("failed")
        connectedAt = null
        markVideoNotReady("connection failed")
      } else if (pc.connectionState === "closed") {
        setStatus("closed")
        connectedAt = null
      } else {
        // "connecting"/"disconnected"/"new" — no longer a confirmed
        // connected state, so a stale connectedAt timestamp from a
        // previous connected period must not keep counting toward the
        // media-readiness timeout below.
        connectedAt = null
      }
    }

    // Sender self-heal — confirms the video/audio RTCRtpSender still
    // actually has the track it's supposed to (`replaceTrack` calls are
    // fire-and-forget elsewhere in this file; a rejected one is logged but
    // otherwise left as-is). If a sender's `.track` has unexpectedly gone
    // null/stale relative to what videoTrackRef/audioTrackRef says is
    // current, that's this account silently sending no video/audio despite
    // everything else looking connected — reapply replaceTrack rather than
    // just logging it and leaving it broken. Runs for both the initiator
    // and the receiver identically — this whole effect is symmetric.
    function checkSenderHealth() {
      const { video, audio } = sendersRef.current
      if (video && video.track !== videoTrackRef.current) {
        console.error("webrtc: video sender's track doesn't match the current camera track — reapplying replaceTrack", {
          roomId,
          senderHasTrack: Boolean(video.track),
          expectedTrack: Boolean(videoTrackRef.current),
        })
        video
          .replaceTrack(videoTrackRef.current)
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (video) failed", { roomId, error: String(err) }))
      }
      if (audio && audio.track !== audioTrackRef.current) {
        console.error("webrtc: audio sender's track doesn't match the current mic track — reapplying replaceTrack", {
          roomId,
          senderHasTrack: Boolean(audio.track),
          expectedTrack: Boolean(audioTrackRef.current),
        })
        audio
          .replaceTrack(audioTrackRef.current)
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (audio) failed", { roomId, error: String(err) }))
      }
    }

    const collectStats = makeStatsCollector(pc)
    let tickCount = 0
    let videoReadyLocal = false

    const tick = async () => {
      tickCount += 1
      const stats = await collectStats()
      if (stats) {
        if (tickCount % LOG_EVERY_N_TICKS === 0) {
          console.log("webrtc: stats", { roomId, ...stats })
        }

        // remoteVideoReady: a live video track has arrived AND getStats()
        // confirms real decoded frames — either alone is exactly the kind
        // of false-positive this whole investigation started from (ICE/
        // DTLS "connected" with nothing actually decoding).
        if (!videoReadyLocal && remoteVideoTrackLive && (stats.incoming.framesDecoded ?? 0) > 0) {
          videoReadyLocal = true
          console.log("webrtc: remote video ready — live track + frames decoding", {
            roomId,
            framesDecoded: stats.incoming.framesDecoded,
          })
          setRemoteVideoReady(true)
        }

        // Media-recovery timeout: connectionState says "connected", but no
        // decoded remote video frames within MEDIA_READY_TIMEOUT_MS of
        // becoming connected — treat this as a real media failure rather
        // than displaying the fallback background indefinitely. Reuses the
        // exact same recovery path a genuine connectionState "failed"
        // already goes through (restartIce() + reporting status "failed",
        // which useMatchmaking.ts's existing stuck-connection handling
        // already watches for and eventually skips past) — no new
        // recovery machinery, just a second, more skeptical trigger for it.
        if (!videoReadyLocal && connectedAt !== null && !mediaRecoveryAttempted && Date.now() - connectedAt > MEDIA_READY_TIMEOUT_MS) {
          mediaRecoveryAttempted = true
          console.error("webrtc: connected but no remote video frames decoded within timeout — attempting recovery", {
            roomId,
            elapsedMs: Date.now() - connectedAt,
          })
          pc.restartIce()
          setStatus("failed")
        }
      }
      checkSenderHealth()
    }
    const tickInterval = setInterval(tick, TICK_INTERVAL_MS)

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
      clearInterval(tickInterval)
      unsubscribe()
      pc.close()
      pcRef.current = null
      sendersRef.current = { video: null, audio: null }
      setStatus("closed")
      setRemoteStream(null)
      setRemoteVideoReady(false)
    }
    // videoTrack/audioTrack are deliberately excluded: the effect below keeps
    // them in sync via replaceTrack (and this effect's own checkSenderHealth
    // self-heal) without recreating the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, initiator, sendSignal, onSignal])

  // Swap the outgoing tracks whenever the camera/mic is toggled or a
  // different device is chosen — replaceTrack only, never renegotiation.
  // Also keeps videoTrackRef/audioTrackRef current for the room effect's
  // own checkSenderHealth self-heal to read.
  useEffect(() => {
    videoTrackRef.current = videoTrack
    audioTrackRef.current = audioTrack
    const { video, audio } = sendersRef.current
    if (video && video.track !== videoTrack) {
      video.replaceTrack(videoTrack).catch((err) => console.error("webrtc: replaceTrack (video) failed", { error: String(err) }))
    }
    if (audio && audio.track !== audioTrack) {
      audio.replaceTrack(audioTrack).catch((err) => console.error("webrtc: replaceTrack (audio) failed", { error: String(err) }))
    }
  }, [videoTrack, audioTrack])

  return { remoteStream, remoteVideoReady, status }
}
