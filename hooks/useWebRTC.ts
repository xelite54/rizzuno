"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createRtcNegotiation } from "@/lib/rtcNegotiation"
import { createRoomSenders } from "@/lib/roomSenders"
import type { PeerPlaybackReport } from "@/lib/peerPlayback"
import type { RtcSignal } from "@/lib/signaling/protocol"

/**
 * A short-lived TURN credential fetched from app/api/realtime/turn (see
 * lib/turnCredentials.ts) — module-level, not React state, and shared by
 * every RTCPeerConnection this tab ever creates for the rest of the
 * session (kept warm by refreshTurnCredentials/the effect that schedules
 * it further down), not re-fetched per room/per skip. `null` means either
 * "haven't fetched yet" or "this deployment has no TURN configured at
 * all" — buildIceServers() below treats both the same way: fall through to
 * whatever legacy static config exists, or STUN-only.
 */
let ephemeralTurnServer: { iceServer: RTCIceServer; expiresAt: number } | null = null

/**
 * Refetches the short-lived TURN credential. Never throws — a failed
 * refresh (network hiccup, not signed in yet, deployment has no TURN)
 * just leaves whatever was already cached in place (or null) for
 * buildIceServers() to fall back from; the caller (the keep-warm effect
 * below) is what decides when to try again.
 */
async function refreshTurnCredentials(): Promise<void> {
  try {
    const res = await fetch("/api/realtime/turn", { cache: "no-store", signal: AbortSignal.timeout(3000) })
    if (!res.ok) return
    const data = (await res.json()) as
      | { configured: true; urls: string[]; username: string; credential: string; ttlSeconds: number }
      | { configured: false }
    if (!data.configured) {
      ephemeralTurnServer = null
      return
    }
    ephemeralTurnServer = {
      iceServer: { urls: sortUdpFirst(data.urls), username: data.username, credential: data.credential },
      expiresAt: Date.now() + data.ttlSeconds * 1000,
    }
  } catch {
    // Network hiccup — leave whatever's cached as-is; see this function's
    // own doc comment.
  }
}

// Refresh this far ahead of actual expiry — a room effect that happens to
// start constructing an RTCPeerConnection right as the cached credential
// is about to lapse must never risk using one that's already invalid, or
// that invalidates mid-call.
const TURN_REFRESH_MARGIN_SECONDS = 60
// How long to wait before checking again when this deployment currently
// has no TURN configured at all — cheap enough to just periodically
// re-check (an operator can add TURN_STATIC_AUTH_SECRET/NEXT_PUBLIC_TURN_URL
// without every open tab needing a hard reload to pick it up), rare enough
// that it's not meaningful background traffic.
const TURN_RECHECK_WHEN_UNCONFIGURED_MS = 5 * 60_000

/**
 * Google's public STUN servers are always present as a fallback. A TURN
 * relay is added on top, only if actually configured — without one, two
 * peers behind symmetric NATs or restrictive corporate/mobile-carrier
 * firewalls can fail to establish a direct connection at all (STUN alone
 * can't traverse those; it only helps discover a public address, it can't
 * relay traffic). Prefers a fresh, short-lived credential from
 * app/api/realtime/turn (see lib/turnCredentials.ts) whenever one is
 * cached and not yet expired; falls back to legacy static
 * NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL (still supported, for a TURN
 * provider that doesn't support short-lived credentials, or during a
 * migration to TURN_STATIC_AUTH_SECRET) if the ephemeral one isn't
 * available; falls back to STUN-only if neither is configured. Called
 * fresh every time the room's one RTCPeerConnection is created (never
 * cached as a frozen module constant) so a rotated ephemeral credential is
 * always picked up by the next room/skip, not just whatever was true the
 * first time this file loaded.
 */
export function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
  if (ephemeralTurnServer && ephemeralTurnServer.expiresAt > Date.now()) {
    servers.push(ephemeralTurnServer.iceServer)
    return servers
  }
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL
  if (turnUrl && process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_CREDENTIAL) {
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

/** Whether `servers` (as returned by buildIceServers()) actually includes a TURN entry, of either kind — used only for the dev-only "is TURN even configured" diagnostic below; never for any behavioral decision. */
function includesTurn(servers: RTCIceServer[]): boolean {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls]
    return urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"))
  })
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

// A ceiling sized for the 720p default capture (see useLocalMedia.ts's
// VIDEO_CONSTRAINTS) — 1.8 Mbps is comfortably enough for clear face
// quality at that resolution without unnecessarily pushing bandwidth,
// packet loss risk, TURN relay cost, and mobile CPU/battery the way the
// previous 4 Mbps ceiling (sized for 1080p) did. This is a ceiling, never
// a required/forced sending rate — WebRTC congestion control and balanced
// degradation (see configureVideoEncoding's own doc comment) can still
// reduce bitrate, resolution, and frame rate further when bandwidth or the
// device can't sustain even this much.
const MAX_VIDEO_BITRATE_BPS = 1_800_000
const MAX_VIDEO_FRAMERATE = 30

/**
 * Applies a 720p-oriented realtime ceiling to the outgoing video sender —
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

// A short, bounded grace window for `disconnected` (never `failed`, which
// recovers immediately — see decideConnectionRecoveryAction) to resolve on
// its own before treating it as needing ICE recovery at all. `disconnected`
// is exactly the transient state a brief Wi-Fi handoff or a few seconds of
// weak signal produces on its own, and the ICE agent frequently returns to
// `connected` within a couple of seconds with no recovery action needed —
// starting an ICE restart immediately on every such blip would make
// ordinary network jitter feel like the call keeps breaking.
const DISCONNECTED_GRACE_MS = 5_000
// How long the ONE allowed ICE restart (lib/rtcNegotiation.ts — never a
// loop, never a second RTCPeerConnection) is given to actually resolve
// this problem — see terminate()'s own call site below. Not cleared merely
// by the transport reaching "connected" again: real success is measured by
// peer video playback, so a restart that reconnects the transport but never actually
// gets video flowing again still counts as failed once this elapses.
const ICE_RESTART_DEADLINE_MS = 15_000

// Stats explain transport/decoder failures; only the peer tile proves playback.
const TICK_INTERVAL_MS = 1_000
const LOG_EVERY_N_TICKS = 5

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

/** Safe media counters only: no SDP, addresses, ports, or credentials. */
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
  /**
   * The server's authoritative "both sides are genuinely rtc-ready — you
   * (the designated initiator) may now start negotiation" signal, threaded
   * straight through from useMatchmaking.ts's own "rtc-start" handling
   * (already room-scoped/staleness-guarded there — see isCurrentRoom).
   * Only ever meaningful for `initiator === true`; the non-initiator's
   * flow is entirely unaffected — it only ever reacts to an incoming
   * offer. The initiator must not create/send an SDP offer before this
   * arrives, even though it already knows `initiator: true` from
   * "matched" — that's the entire point: "matched" alone never proved the
   * OTHER side had gotten far enough to receive one.
   */
  rtcStart: boolean
  sendSignal: (roomId: string, data: RtcSignal) => void
  onSignal: (roomId: string, handler: (roomId: string, data: RtcSignal) => void) => () => void
}

// One connection per room. Capture changes and signaling actions operate on
// that connection through stable refs; none are room-effect dependencies.
export function useWebRTC({ roomId, initiator, videoTrack, audioTrack, micEnabled, rtcStart, sendSignal, onSignal }: UseWebRTCParams) {
  const [media, setMedia] = useState<{
    roomId: string | null
    status: PeerConnectionStatus
    remoteStream: MediaStream | null
    remoteVideoReady: boolean
    rtcInitialized: boolean
    connectionFailed: boolean
  }>({ roomId: null, status: "new", remoteStream: null, remoteVideoReady: false, rtcInitialized: false, connectionFailed: false })
  const currentRef = useRef({ videoTrack, audioTrack, micEnabled, initiator, sendSignal, onSignal })
  useLayoutEffect(() => {
    currentRef.current = { videoTrack, audioTrack, micEnabled, initiator, sendSignal, onSignal }
  })
  const syncTracksRef = useRef<(() => Promise<void>) | null>(null)
  const startRef = useRef<(() => void) | null>(null)
  const playbackRef = useRef<((report: PeerPlaybackReport) => void) | null>(null)
  const reportPlaybackConfirmed = useCallback((report: PeerPlaybackReport) => playbackRef.current?.(report), [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function tick() {
      await refreshTurnCredentials()
      if (cancelled) return
      const delay = ephemeralTurnServer
        ? Math.max(30_000, ephemeralTurnServer.expiresAt - Date.now() - TURN_REFRESH_MARGIN_SECONDS * 1000)
        : TURN_RECHECK_WHEN_UNCONFIGURED_MS
      timer = setTimeout(tick, delay)
    }
    void tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!roomId) return
    const rtcInstanceId = crypto.randomUUID()
    const iceServers = buildIceServers()
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" })
    const senders = createRoomSenders(pc)
    let disposed = false
    let terminated = false
    let initialized = false
    let started = false
    let phase = "local-capture"
    let remoteStream: MediaStream | null = null
    let videoPlaying = false
    let active = false
    let latestStats: CollectedStats | null = null
    let lastPlayback: Omit<PeerPlaybackReport, "stream" | "track"> | null = null
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let restartTimer: ReturnType<typeof setTimeout> | undefined
    let mediaTimer: ReturnType<typeof setTimeout> | undefined
    // The hook can mount before sign-in, when its warm-up fetch gets 401.
    // Refresh before negotiating the first room so TURN is not silently
    // absent for five minutes. Timeout preserves direct/STUN connectivity.
    let syncChain = (ephemeralTurnServer && ephemeralTurnServer.expiresAt > Date.now()
      ? Promise.resolve() : refreshTurnCredentials()).then(() => {
        if (!disposed && !terminated) pc.setConfiguration({ iceServers: buildIceServers(), iceTransportPolicy: "all" })
      })
    let configuredSender: RTCRtpSender | null = null
    let loggedVideoTrack: MediaStreamTrack | null = null
    const trackCleanups = new Map<MediaStreamTrack, () => void>()
    const log = (event: string, details = {}) => console.log(`webrtc: ${event}`, { roomId, rtcInstanceId, ...details })
    const update = (patch: Partial<typeof media>) => {
      if (!disposed) setMedia(previous => previous.roomId === roomId ? { ...previous, ...patch } : previous)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- establishing the room's external media resource
    setMedia({ roomId, status: "connecting", remoteStream: null, remoteVideoReady: false, rtcInitialized: false, connectionFailed: false })
    log("peer created", { initiator: currentRef.current.initiator, turnConfigured: includesTurn(iceServers) })

    function diagnostics() {
      const local = currentRef.current.videoTrack
      const transceiver = pc.getTransceivers().find(t => t.sender === senders.video)
      return {
        phase,
        mediaStage: !local || local.readyState !== "live" ? "local-capture"
          : senders.video?.track !== local ? "local-sender"
          : transceiver?.mid == null || transceiver.currentDirection !== "sendrecv" ? "video-SDP"
          : pc.connectionState !== "connected" ? "transport"
          : !remoteStream?.getVideoTracks().length ? "remote-ontrack"
          : !lastPlayback ? "peer-element-awaiting-playback"
          : !videoPlaying ? "peer-element-not-playing" : "playing",
        localVideoReadyState: local?.readyState ?? null,
        localVideoEnabled: local?.enabled ?? false,
        localVideoMuted: local?.muted ?? false,
        senderHasVideoTrack: Boolean(senders.video?.track),
        senderMatchesLocalVideo: Boolean(local && senders.video?.track === local),
        videoDirection: transceiver?.direction ?? null,
        negotiatedVideoDirection: transceiver?.currentDirection ?? null,
        videoTransceiverAssociated: transceiver?.mid != null,
        remoteVideoTrackCount: remoteStream?.getVideoTracks().length ?? 0,
        signalingState: pc.signalingState,
        iceState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        playback: lastPlayback,
        incoming: latestStats?.incoming ?? null,
        outgoing: latestStats?.outgoing ?? null,
      }
    }
    function terminate(reason: string) {
      if (disposed || terminated) return
      log("room failed", { reason, ...diagnostics() })
      terminated = true
      clearTimeout(graceTimer)
      clearTimeout(restartTimer)
      clearTimeout(mediaTimer)
      clearTimeout(setupTimer)
      update({ connectionFailed: true, remoteVideoReady: false, status: "failed" })
    }
    function checkActive() {
      const nowActive = pc.connectionState === "connected" && videoPlaying
      if (nowActive) {
        clearTimeout(mediaTimer); mediaTimer = undefined
        clearTimeout(setupTimer)
        if (negotiation.recovered()) { clearTimeout(restartTimer); restartTimer = undefined }
        if (!active) log("active", diagnostics())
      } else if (pc.connectionState === "connected" && !mediaTimer) {
        // A connected transport with no rendered peer video is a media
        // failure, not an excuse to rebuild the PC or spin indefinitely.
        mediaTimer = setTimeout(() => {
          mediaTimer = undefined
          terminate("remote-video-playback-timeout")
        }, 20_000)
      }
      active = nowActive
      update({ remoteVideoReady: videoPlaying, status: pc.connectionState === "connected" ? "connected" : "connecting" })
    }
    function markNotPlaying(reason: string) {
      if (videoPlaying) log("remote video no longer ready", { reason })
      videoPlaying = false
      checkActive()
    }
    function armRestartDeadline() {
      if (restartTimer || disposed || terminated) return
      markNotPlaying("ICE restart")
      restartTimer = setTimeout(() => terminate("ICE-restart-timeout"), ICE_RESTART_DEADLINE_MS)
    }
    const negotiation = createRtcNegotiation(pc, currentRef.current.initiator,
      data => currentRef.current.sendSignal(roomId, data), event => {
        if (disposed || terminated) return
        log(event)
        if (["offer sent", "offer received", "answer sent", "answer received"].includes(event)) phase = event
        if (event === "ICE restart started") armRestartDeadline()
        if (event === "negotiation failed" || event === "ICE restart failed") terminate(event)
        if (event === "answer sent" || event === "answer received") log("SDP negotiated", diagnostics())
      })

    function syncTracks() {
      syncChain = syncChain.then(async () => {
        if (disposed || terminated) return
        const capture = currentRef.current
        const ready = await senders.sync(capture.videoTrack, capture.audioTrack, capture.micEnabled)
        if (disposed || terminated) return
        if (configuredSender !== senders.video && senders.video) {
          configuredSender = senders.video
          void configureVideoEncoding(senders.video)
        }
        // If capture changed during replaceTrack, the next queued sync
        // applies it; never acknowledge readiness for a stale camera.
        if (capture.videoTrack !== currentRef.current.videoTrack || capture.audioTrack !== currentRef.current.audioTrack || capture.micEnabled !== currentRef.current.micEnabled) return
        if (senders.video?.track && senders.video.track !== loggedVideoTrack) {
          loggedVideoTrack = senders.video.track
          log("local video attached", diagnostics())
        }
        if (ready && !initialized) {
          initialized = true
          phase = "waiting-for-rtc-start"
          log("rtc initialized", diagnostics())
        }
        update({ rtcInitialized: ready })
      }).catch(error => {
        log("local track attachment failed", { error: error instanceof Error ? error.name : "RTCError" })
        terminate("local-track-attachment-failed")
      })
      return syncChain
    }
    syncTracksRef.current = syncTracks

    pc.ontrack = event => {
      if (disposed || terminated || event.target !== pc) return
      const track = event.track
      if (track.kind !== "video" && track.kind !== "audio") return
      if (track === currentRef.current.videoTrack || track === currentRef.current.audioTrack) {
        terminate("local-track-received-as-remote")
        return
      }
      const previous = remoteStream?.getTracks() ?? []
      if (previous.includes(track)) return
      for (const old of previous.filter(t => t.kind === track.kind)) {
        trackCleanups.get(old)?.()
        trackCleanups.delete(old)
      }
      // A new stream snapshot gives React an update even for audio-first
      // delivery or replacement of the video track in an existing room.
      remoteStream = new MediaStream([...previous.filter(t => t.kind !== track.kind), track])
      markNotPlaying("remote stream changed")
      log(track.kind === "video" ? "remote video ontrack" : "remote audio ontrack", {
        kind: track.kind, readyState: track.readyState, muted: track.muted,
        remoteVideoTrackCount: remoteStream.getVideoTracks().length,
      })
      update({ remoteStream })
      const isCurrent = () => !disposed && !terminated && Boolean(remoteStream?.getTracks().includes(track))
      const ended = () => {
        if (!isCurrent()) return
        remoteStream = new MediaStream(remoteStream!.getTracks().filter(t => t !== track))
        update({ remoteStream })
        if (track.kind === "video") markNotPlaying("remote track ended")
      }
      const muted = () => { if (isCurrent() && track.kind === "video") markNotPlaying("remote track muted") }
      const unmuted = () => { if (isCurrent()) log("remote track unmuted", { kind: track.kind }) }
      track.addEventListener("ended", ended)
      track.addEventListener("mute", muted)
      track.addEventListener("unmute", unmuted)
      trackCleanups.set(track, () => {
        track.removeEventListener("ended", ended)
        track.removeEventListener("mute", muted)
        track.removeEventListener("unmute", unmuted)
      })
    }
    playbackRef.current = report => {
      if (disposed || terminated || report.roomId !== roomId || report.stream !== remoteStream) return
      if (report.track !== remoteStream?.getVideoTracks()[0]) return
      const details = { roomId: report.roomId, playing: report.playing, readyState: report.readyState, videoWidth: report.videoWidth, videoHeight: report.videoHeight }
      lastPlayback = details
      const ready = report.playing && report.track.readyState === "live" && !report.track.muted && report.readyState >= 2 && report.videoWidth > 0 && report.videoHeight > 0
      if (ready && !videoPlaying) log("peer video playing", details)
      videoPlaying = ready
      checkActive()
    }
    pc.onicecandidate = event => {
      if (!disposed && !terminated && event.candidate) currentRef.current.sendSignal(roomId, { kind: "ice", candidate: event.candidate.toJSON() })
    }
    function transportChanged() {
      if (disposed || terminated) return
      const disconnected = pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected"
      const failed = pc.connectionState === "failed" || pc.iceConnectionState === "failed"
      const healthy = pc.connectionState === "connected" && ["connected", "completed"].includes(pc.iceConnectionState)
      if (healthy) { clearTimeout(graceTimer); graceTimer = undefined }
      if (disconnected || failed) {
        markNotPlaying("transport interrupted")
        clearTimeout(mediaTimer); mediaTimer = undefined
        const recover = () => {
          graceTimer = undefined
          if (disposed || terminated || restartTimer) return
          const stillUnhealthy = ["disconnected", "failed"].includes(pc.connectionState) || ["disconnected", "failed"].includes(pc.iceConnectionState)
          if (!stillUnhealthy) return
          if (!negotiation.recoveryAvailable()) { terminate("ICE restart already used for this room"); return }
          void negotiation.recover()
        }
        if (!restartTimer) {
          if (failed) { clearTimeout(graceTimer); recover() }
          else if (!graceTimer) graceTimer = setTimeout(recover, DISCONNECTED_GRACE_MS)
        }
      }
      checkActive()
    }
    pc.oniceconnectionstatechange = () => { log("ICE state", { state: pc.iceConnectionState }); transportChanged() }
    pc.onconnectionstatechange = () => { log("connection state", { state: pc.connectionState }); transportChanged() }
    const unsubscribe = currentRef.current.onSignal(roomId, (incomingRoom, data) => {
      if (disposed || terminated || incomingRoom !== roomId) return
      if (data.kind === "ice") { void negotiation.receive(data); return }
      void syncTracks().then(() => { if (!disposed && !terminated) void negotiation.receive(data) })
    })
    startRef.current = () => {
      if (started || !currentRef.current.initiator || disposed || terminated) return
      started = true
      void syncTracks().then(() => { if (!disposed && !terminated && initialized) void negotiation.start() })
    }
    void syncTracks()
    const setupTimer = setTimeout(() => terminate("room-establishment-timeout"), 40_000)
    const collectStats = makeStatsCollector(pc)
    let collecting = false
    let ticks = 0
    const statsTimer = setInterval(() => {
      if (disposed || terminated || collecting) return
      collecting = true
      void collectStats().then(stats => {
        if (disposed || terminated) return
        latestStats = stats
        if (++ticks % LOG_EVERY_N_TICKS === 0) log("media diagnostics", diagnostics())
        // Receiver decoding is diagnostic only. It never proves that the
        // peer element has rendered a frame and must never activate a call.
      }).finally(() => { collecting = false })
    }, TICK_INTERVAL_MS)
    return () => {
      disposed = true
      clearTimeout(graceTimer); clearTimeout(restartTimer); clearTimeout(mediaTimer); clearTimeout(setupTimer)
      clearInterval(statsTimer)
      unsubscribe()
      negotiation.dispose()
      trackCleanups.forEach(cleanup => cleanup())
      pc.ontrack = null
      pc.onicecandidate = null
      pc.onconnectionstatechange = null
      pc.oniceconnectionstatechange = null
      pc.close()
      syncTracksRef.current = null
      startRef.current = null
      playbackRef.current = null
      log("peer disposed", { reason: "room-ended-or-unmounted" })
    }
  }, [roomId])

  useEffect(() => { void syncTracksRef.current?.() }, [videoTrack, audioTrack, micEnabled])
  useEffect(() => { if (rtcStart) startRef.current?.() }, [rtcStart, roomId])
  const current = media.roomId === roomId && roomId !== null
  return {
    remoteStream: current ? media.remoteStream : null,
    remoteVideoReady: current && media.remoteVideoReady,
    rtcInitialized: current && media.rtcInitialized,
    connectionFailed: current && media.connectionFailed,
    status: current ? media.status : "new" as PeerConnectionStatus,
    reportPlaybackConfirmed,
  }
}
