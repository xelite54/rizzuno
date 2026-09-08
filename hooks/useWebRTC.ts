"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createRtcNegotiation } from "@/lib/rtcNegotiation"
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
export function buildIceServers(): RTCIceServer[] {
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

// Give the preferred 1080p capture more encoding headroom on good networks.
// This is a ceiling, never a required/forced sending rate. WebRTC congestion
// control and balanced degradation can still reduce bitrate, resolution,
// and frame rate when bandwidth or the device cannot sustain them.
const MAX_VIDEO_BITRATE_BPS = 4_000_000
const MAX_VIDEO_FRAMERATE = 30

/**
 * Applies a 1080p-oriented realtime ceiling to the outgoing video sender —
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
    console.error("webrtc: failed to configure video encoding parameters", { error: err instanceof Error ? err.name : "RTCError" })
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

// Detect connected-without-video using the existing stats tick; recovery never leaves the room.
const MEDIA_READY_TIMEOUT_MS = 12_000
// Diagnostic deadline only: never tears down a room or schedules another
// attempt. Use the existing stats tick, not a second recovery timer.
const ICE_RECOVERY_DEADLINE_MS = 30_000

type CollectedStats = {
  candidateType: string | null
  remoteCandidateType: string | null
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
 * Safe media diagnostics for the "connected but no remote video
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
    let remoteCandidateType: string | null = null
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
        const remote = typeof pair.remoteCandidateId === "string" ? report.get(pair.remoteCandidateId) : undefined
        if (remote?.type === "remote-candidate") remoteCandidateType = remote.candidateType ?? null
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
      remoteCandidateType,
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
  /**
   * Whether the mic should actually be heard right now. useLocalMedia.ts
   * already sets `audioTrack.enabled = micEnabled` (a real, spec-correct
   * mute on its own — a disabled track sends silence), but that's the
   * ONLY thing enforcing it: this hook used to never see `micEnabled` at
   * all, so muting was exactly one property write away from ever reaching
   * the peer, with nothing here reinforcing it. This hook now ALSO
   * detaches the audio track from the sender entirely (`replaceTrack(null)`)
   * whenever muted, restoring it on unmute — belt-and-suspenders: even if
   * something ever left `.enabled` untouched (a missed toggle, a fresh
   * track from a mic switch/reacquire arriving before that effect re-runs,
   * a future refactor), there is still no audio track on the sender at
   * all for the peer to possibly receive anything from.
   */
  micEnabled: boolean
  sendSignal: (roomId: string, data: RtcSignal) => void
  onSignal: (roomId: string, handler: (roomId: string, data: RtcSignal) => void) => () => void
}

/**
 * One RTCPeerConnection per room. A video and an audio transceiver are
 * created up front (sendrecv, even before a local track exists), so every
 * camera/mic toggle or device switch afterward is a plain `replaceTrack`
 * call — never a renegotiation — and turning the camera off, back on, or
 * swapping devices mid-call never disrupts the connection.
 */
export function useWebRTC({ roomId, initiator, videoTrack, audioTrack, micEnabled, sendSignal, onSignal }: UseWebRTCParams) {
  const [status, setStatus] = useState<PeerConnectionStatus>("new")
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sendersRef = useRef<{ video: RTCRtpSender | null; audio: RTCRtpSender | null }>({ video: null, audio: null })
  // Mirrors the latest videoTrack/audioTrack/micEnabled props for the room
  // effect's own closure to read without needing them in its dependency
  // array (which would tear down and recreate the whole RTCPeerConnection
  // on every camera toggle — see that effect's own trailing comment).
  // Kept current by the replaceTrack-syncing effect further down.
  const videoTrackRef = useRef<MediaStreamTrack | null>(videoTrack)
  const audioTrackRef = useRef<MediaStreamTrack | null>(audioTrack)
  const micEnabledRef = useRef(micEnabled)
  // Starts null, not an eagerly-created empty MediaStream — see the
  // ontrack handler below for why: attaching an always-present-but-empty
  // stream to <video> up front, then mutating it as tracks trickle in, is
  // exactly the pattern that made it easy to believe "the video element
  // has a stream" while it might still have zero actual tracks. null here
  // means exactly what it says: no remote media has arrived yet.
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  // True once remote video is genuinely proven ready, by EITHER of two
  // independent kinds of evidence — never just "ICE/DTLS says connected"
  // alone. This is what useMatchmaking.ts's `state` derivation gates
  // "active" on, instead of `status === "connected"` alone (see that
  // file) — the whole point being that the matched-profile UI never shows
  // over what would otherwise be an empty peer tile.
  //
  // 1. Stats proof (the tick loop further down): a live remote video
  //    track has arrived AND getStats() confirms real frames are actually
  //    decoding. This was the original, and remains the primary, signal.
  //
  // 2. Playback proof (reportPlaybackConfirmed below, called from
  //    VideoTile.tsx via useMatchmaking.ts — see its own doc comment):
  //    the peer's actual <video> element reached "playing", with a real
  //    track/stream attached and real decoded dimensions. Added because
  //    stats proof alone is too browser-specific — iOS Safari in
  //    particular can render remote video correctly while
  //    getStats().framesDecoded is missing, delayed, or unreliable,
  //    which left a genuinely working call stuck on "Connecting"
  //    forever. A real <video> element actually playing is, if anything,
  //    STRONGER evidence than a stats counter — it's the exact thing the
  //    person is looking at.
  //
  // Both write into this SAME state, so "active" itself never needs to
  // know which proof satisfied it. Both are reset by the identical set of
  // real WebRTC-level events (markVideoNotReady, below) — track
  // ended/muted, transport no longer connected, an ICE restart starting —
  // so playback proof inherits every existing reset case for free, rather
  // than needing its own parallel, easy-to-drift-apart copy of that logic.
  const [remoteVideoReady, setRemoteVideoReady] = useState(false)
  // Lets reportPlaybackConfirmed (below, and this hook's return value)
  // reach into whichever room-effect instance is CURRENTLY live, without
  // needing that effect's own internals (videoReadyLocal, recoveryBaseline,
  // cancelled, the room's own `roomId` closure) as an external dependency.
  // Reassigned every time the room effect (re)runs, to that instance's own
  // handler; cleared to null on that instance's cleanup — so a call that
  // arrives after a room has genuinely ended, before any new one has
  // started, is a safe no-op instead of reaching into a torn-down closure.
  const reportPlaybackConfirmedRef = useRef<((forRoomId: string) => void) | null>(null)
  const reportPlaybackConfirmed = useCallback((forRoomId: string) => {
    reportPlaybackConfirmedRef.current?.(forRoomId)
  }, [])
  const [mediaRoom, setMediaRoom] = useState<string | null>(null)

  useEffect(() => {
    if (!roomId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh room starts with neither known yet, same as `status` below
    setRemoteStream(null)
    setMediaRoom(roomId)
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
    let cancelled = false
    let recoveryStartedAt: number | null = null
    let recoveryBaseline = 0
    let lastDecodedFrames = 0
    let videoReadyLocal = false
    const negotiation = createRtcNegotiation(pc, initiator, (data) => sendSignal(roomId, data), (event) => {
      console.debug(`webrtc: ${event}`, { roomId })
      if (event === "ICE restart started") {
        recoveryStartedAt = Date.now()
        recoveryBaseline = lastDecodedFrames
        videoReadyLocal = false
        setRemoteVideoReady(false)
      }
    })

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
        error: err instanceof Error ? err.name : "RTCError",
      })
    }

    if (videoTrack) {
      videoTransceiver.sender
        .replaceTrack(videoTrack)
        .catch((err) => console.error("webrtc: replaceTrack (initial video) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
    }
    // Muted-at-room-start (e.g. a fresh match landed on right after a skip
    // made mid-mute) must never briefly attach the real audio track before
    // some later effect gets around to detaching it again — `micEnabledRef`
    // (see its own doc comment) already reflects the current mute state by
    // the time this runs, so the sender simply never receives a track to
    // begin with rather than attaching-then-immediately-removing one.
    if (audioTrack && micEnabledRef.current) {
      audioTransceiver.sender
        .replaceTrack(audioTrack)
        .catch((err) => console.error("webrtc: replaceTrack (initial audio) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
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
      videoReadyLocal = false
      recoveryBaseline = lastDecodedFrames
      console.log("webrtc: remote video no longer ready", { roomId, reason })
      setRemoteVideoReady(false)
    }

    // The playback-proof path — see remoteVideoReady's own doc comment
    // above for why this exists alongside the stats path below, not
    // instead of it. `forRoomId` is checked against this EFFECT
    // INSTANCE's own `roomId` (not a live/mutable value — this whole
    // effect tears down and a fresh one runs whenever the room actually
    // changes), so a stale report from a room that's already ended can
    // never mark a later room ready; useMatchmaking.ts's own
    // isCurrentRoom() check on the way in here is the second, independent
    // layer of that same protection. `remoteVideoTrackLive` (kept current
    // by the track's own mute/unmute handlers below) is re-verified here
    // too — VideoTile.tsx already checks the track before ever calling
    // this, but trusting that alone would make a bug in that unrelated
    // file able to silently defeat this one's own guarantee.
    function reportPlaybackConfirmedForThisRoom(forRoomId: string) {
      if (cancelled || forRoomId !== roomId || videoReadyLocal || !remoteVideoTrackLive) return
      console.log("webrtc: remote video ready — confirmed by actual <video> playback, not just stats", { roomId })
      videoReadyLocal = true
      recoveryBaseline = lastDecodedFrames
      setRemoteVideoReady(true)
      negotiation.recovered()
      recoveryStartedAt = null
    }
    reportPlaybackConfirmedRef.current = reportPlaybackConfirmedForThisRoom

    pc.ontrack = (event) => {
      const track = event.track
      // Track diagnostics — see makeStatsCollector's own doc comment
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
        if (track.kind === "video") {
          remoteVideoTrackLive = false
          markVideoNotReady("track muted")
        }
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

    const recover = () => { void negotiation.recover() }
    pc.onicegatheringstatechange = () => {
      if (!cancelled) console.debug("webrtc: ICE gathering state", { roomId, state: pc.iceGatheringState })
    }
    pc.oniceconnectionstatechange = () => {
      if (cancelled) return
      console.debug("webrtc: ICE connection state", { roomId, state: pc.iceConnectionState })
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") recover()
    }
    pc.onconnectionstatechange = () => {
      if (cancelled) return
      console.debug("webrtc: peer connection state", { roomId, state: pc.connectionState })
      if (pc.connectionState === "connected") {
        setStatus("connected")
        connectedAt = Date.now()
      } else {
        connectedAt = null
        setStatus(pc.connectionState === "closed" ? "closed" : "connecting")
        markVideoNotReady("transport not connected")
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") recover()
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
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (video) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
      }
      // The "correct" audio track is null while muted, not
      // audioTrackRef.current — see micEnabled's own doc comment on
      // UseWebRTCParams. Without this, self-heal would fight the mute
      // itself: every tick, it would see the sender's track (null, because
      // the mute effect below deliberately detached it) not matching
      // audioTrackRef.current (the real mic track) and "fix" that by
      // reattaching it, undoing the mute within about a second.
      const desiredAudioTrack = micEnabledRef.current ? audioTrackRef.current : null
      if (audio && audio.track !== desiredAudioTrack) {
        console.error("webrtc: audio sender's track doesn't match what it should be (mic track, or null while muted) — reapplying replaceTrack", {
          roomId,
          senderHasTrack: Boolean(audio.track),
          expectedTrack: Boolean(desiredAudioTrack),
          micEnabled: micEnabledRef.current,
        })
        audio
          .replaceTrack(desiredAudioTrack)
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (audio) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
      }
    }

    const collectStats = makeStatsCollector(pc)
    let tickCount = 0
    let collecting = false

    const tick = async () => {
      if (cancelled || collecting) return
      collecting = true
      tickCount += 1
      const stats = await collectStats()
      collecting = false
      if (cancelled) return
      if (recoveryStartedAt !== null && Date.now() - recoveryStartedAt > ICE_RECOVERY_DEADLINE_MS) {
        negotiation.failed()
        recoveryStartedAt = null
      }
      if (stats) {
        lastDecodedFrames = stats.incoming.framesDecoded ?? 0
        if (tickCount % LOG_EVERY_N_TICKS === 0) {
          console.log("webrtc: stats", { roomId, ...stats })
        }

        // remoteVideoReady: a live video track has arrived AND getStats()
        // confirms real decoded frames — either alone is exactly the kind
        // of false-positive this whole investigation started from (ICE/
        // DTLS "connected" with nothing actually decoding).
        if (!videoReadyLocal && remoteVideoTrackLive && lastDecodedFrames > recoveryBaseline) {
          videoReadyLocal = true
          console.log("webrtc: remote video ready — live track + frames decoding", {
            roomId,
            framesDecoded: stats.incoming.framesDecoded,
          })
          setRemoteVideoReady(true)
          negotiation.recovered()
          recoveryStartedAt = null
        }

        // One bounded in-room recovery for connected-but-no-video.
        if (!videoReadyLocal && connectedAt !== null && Date.now() - connectedAt > MEDIA_READY_TIMEOUT_MS) {
          recover()
        }
      }
      checkSenderHealth()
    }
    const tickInterval = setInterval(tick, TICK_INTERVAL_MS)

    const unsubscribe = onSignal(roomId, (incomingRoomId, data) => {
      if (!cancelled && incomingRoomId === roomId) void negotiation.receive(data)
    })
    if (initiator) void negotiation.start()

    return () => {
      cancelled = true
      negotiation.dispose()
      console.debug("webrtc: peer disposed", { roomId, reason: "room_effect_cleanup" })
      clearInterval(tickInterval)
      unsubscribe()
      pc.close()
      pcRef.current = null
      sendersRef.current = { video: null, audio: null }
      if (reportPlaybackConfirmedRef.current === reportPlaybackConfirmedForThisRoom) reportPlaybackConfirmedRef.current = null
      setStatus("closed")
      setRemoteStream(null)
      setRemoteVideoReady(false)
    }
    // videoTrack/audioTrack are deliberately excluded: the effect below keeps
    // them in sync via replaceTrack (and this effect's own checkSenderHealth
    // self-heal) without recreating the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, initiator, sendSignal, onSignal])

  // Swap the outgoing tracks whenever the camera/mic device is toggled or
  // a different device is chosen, AND whenever mute itself toggles —
  // replaceTrack only, never renegotiation. Also keeps videoTrackRef/
  // audioTrackRef/micEnabledRef current for the room effect's own
  // checkSenderHealth self-heal to read. `desiredAudioTrack` is null
  // whenever muted — see micEnabled's own doc comment on UseWebRTCParams
  // for why the sender is meant to have no audio track at all while
  // muted, not just a disabled one.
  useEffect(() => {
    videoTrackRef.current = videoTrack
    audioTrackRef.current = audioTrack
    micEnabledRef.current = micEnabled
    const { video, audio } = sendersRef.current
    if (video && video.track !== videoTrack) {
      video.replaceTrack(videoTrack).catch((err) => console.error("webrtc: replaceTrack (video) failed", { error: err instanceof Error ? err.name : "RTCError" }))
    }
    const desiredAudioTrack = micEnabled ? audioTrack : null
    if (audio && audio.track !== desiredAudioTrack) {
      audio.replaceTrack(desiredAudioTrack).catch((err) => console.error("webrtc: replaceTrack (audio) failed", { error: err instanceof Error ? err.name : "RTCError" }))
    }
  }, [videoTrack, audioTrack, micEnabled])

  return {
    remoteStream: mediaRoom === roomId ? remoteStream : null,
    remoteVideoReady: mediaRoom === roomId && remoteVideoReady,
    status,
    reportPlaybackConfirmed,
  }
}
