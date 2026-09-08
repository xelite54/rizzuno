"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createRtcNegotiation } from "@/lib/rtcNegotiation"
import { decideConnectionRecoveryAction, decideAfterIceRecoveryDeadline } from "@/lib/webrtcRecovery"
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
    const res = await fetch("/api/realtime/turn", { cache: "no-store" })
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
 * fresh every time an RTCPeerConnection is actually created (never cached
 * as a frozen module constant) specifically so a rotated ephemeral
 * credential is always picked up by the NEXT room/skip/fresh-connection
 * recovery, not just whatever was true the first time this file loaded.
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
// How long the existing bounded ICE restart (lib/rtcNegotiation.ts — one
// attempt, never a loop) is given to actually resolve, checked via the
// existing stats tick rather than a second timer. Exceeding this no longer
// means "give up silently" — see decideAfterIceRecoveryDeadline: the FIRST
// time, it triggers the one additional fresh-RTCPeerConnection recovery
// level (same room, same tracks, one renegotiation); the second time (that
// fresh connection's own ICE restart also not resolving in time), it means
// genuinely giving up and leaving the room — see attemptFreshConnectionRecovery
// and the tick() call site below for both.
const ICE_RECOVERY_DEADLINE_MS = 30_000
// A short, bounded grace window for `disconnected` (never `failed`, which
// recovers immediately — see decideConnectionRecoveryAction) to resolve on
// its own before treating it as needing ICE recovery at all. `disconnected`
// is exactly the transient state a brief Wi-Fi handoff or a few seconds of
// weak signal produces on its own, and the ICE agent frequently returns to
// `connected` within a couple of seconds with no recovery action needed —
// starting an ICE restart immediately on every such blip would make
// ordinary network jitter feel like the call keeps breaking.
const DISCONNECTED_GRACE_MS = 4_000

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
  /**
   * The server's authoritative "both sides are genuinely rtc-ready — you
   * (the designated initiator) may now start negotiation" signal, threaded
   * straight through from useMatchmaking.ts's own "rtc-start" handling
   * (already room-scoped/staleness-guarded there — see isCurrentRoom).
   * Only ever meaningful for `initiator === true`; the non-initiator's
   * flow is entirely unaffected (it only ever reacts to an incoming
   * offer, exactly as before) — see the room effect's own doc comment on
   * `startNegotiationForThisRoom` for why this used to be unconditional
   * (`if (initiator) void negotiation.start()`, fired the instant the
   * RTCPeerConnection was created) and why that was the actual
   * architectural gap behind a real production bug: nothing ever proved
   * the OTHER side had gotten far enough to receive an offer before one
   * could be sent.
   */
  rtcStart: boolean
  sendSignal: (roomId: string, data: RtcSignal) => void
  onSignal: (roomId: string, handler: (roomId: string, data: RtcSignal) => void) => () => void
}

/**
 * Purely internal, diagnostic-only phase tracking for the room-
 * establishment handshake (see server/ws-server.ts's own doc comment on
 * its RoomSetup type for the full design this is the client-side half
 * of). Logged, never returned from this hook and never rendered — the
 * user-facing UI still simply says "Connecting" the entire time (state
 * === "connecting" in useMatchmaking.ts is unchanged); this exists so a
 * stalled setup is diagnosable (which exact phase it stalled at, from the
 * browser's own console) instead of every possible stall looking
 * identical from the outside.
 */
type RtcPhase =
  | "room-created"
  | "rtc-initialized"
  | "waiting-for-peer-ready"
  | "rtc-start-received"
  | "offer-sent"
  | "offer-received"
  | "answer-sent"
  | "answer-received"
  | "ice-connecting"
  | "connected"
  | "media-ready"
  /** The bounded ICE restart didn't resolve in time — closing the broken RTCPeerConnection and building a fresh one for this same room (see attemptFreshConnectionRecovery). */
  | "fresh-connection-recovery"
  /** The fresh connection ALSO didn't resolve — recovery is exhausted; useMatchmaking.ts (via the `connectionFailed` return value) is what actually leaves the room from here. */
  | "connection-failed"

/**
 * One RTCPeerConnection per room. A video and an audio transceiver are
 * created up front (sendrecv, even before a local track exists), so every
 * camera/mic toggle or device switch afterward is a plain `replaceTrack`
 * call — never a renegotiation — and turning the camera off, back on, or
 * swapping devices mid-call never disrupts the connection.
 */
export function useWebRTC({ roomId, initiator, videoTrack, audioTrack, micEnabled, rtcStart, sendSignal, onSignal }: UseWebRTCParams) {
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
  // True once THIS room's RTCPeerConnection, video/audio transceivers, and
  // signal listener are all genuinely set up — see "rtc-ready" in
  // lib/signaling/protocol.ts for what useMatchmaking.ts actually does
  // with this (sends "rtc-ready" to the server once this is true AND its
  // own conditions — realtimeReady, a live local video track — also hold).
  // Reset to false on every room change exactly like remoteStream/
  // remoteVideoReady above, for the same reason: a value describing a room
  // that's since ended must never be mistaken for describing the current
  // one.
  const [rtcInitialized, setRtcInitialized] = useState(false)
  // Lets the "watch rtcStart" effect further down (a small, separate
  // effect — NOT a dependency of the room-creating effect itself, which
  // would tear down and recreate the whole RTCPeerConnection every time
  // the server's readiness handshake progresses) reach into whichever room
  // effect instance is CURRENTLY live, mirroring reportPlaybackConfirmedRef's
  // exact pattern immediately above. Reassigned fresh by every room effect
  // instance; cleared to null on that instance's own cleanup.
  const startNegotiationRef = useRef<(() => void) | null>(null)
  // True once THIS room's recovery is genuinely exhausted — the bounded
  // ICE restart didn't resolve, the one fresh-RTCPeerConnection recovery
  // that followed it didn't either. useMatchmaking.ts watches this and is
  // what actually leaves the room from here (sends "leave", clears local
  // state, decides random-resume vs. idle exactly like an ordinary
  // peer-left — see its own effect). This hook's own job stops at
  // reporting the fact; it never decides to leave a room on its own.
  const [connectionFailed, setConnectionFailed] = useState(false)
  const [mediaRoom, setMediaRoom] = useState<string | null>(null)

  // Keeps the module-level ephemeral TURN credential warm for the whole
  // session — started once, independent of `roomId` (so it's very likely
  // already cached before this account's very first match, not fetched
  // lazily on demand), and reschedules itself before the current
  // credential's own expiry. See buildIceServers()/refreshTurnCredentials()
  // above for what actually consumes/produces this. Deliberately NOT part
  // of the room effect below — TURN credentials rotating must never tear
  // down or recreate an active RTCPeerConnection; only a NEW pc (a new
  // room, a skip, or this file's own fresh-connection recovery) ever reads
  // the current cache, via a fresh buildIceServers() call.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      await refreshTurnCredentials()
      if (cancelled) return
      const delayMs = ephemeralTurnServer
        ? Math.max(30_000, ephemeralTurnServer.expiresAt - Date.now() - TURN_REFRESH_MARGIN_SECONDS * 1000)
        : TURN_RECHECK_WHEN_UNCONFIGURED_MS
      timer = setTimeout(tick, delayMs)
    }
    void tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!roomId) return
    // Narrowed once, used by the few call sites below that need a `string`
    // (not `string | null`) argument — TypeScript's null-narrowing of
    // `roomId` above doesn't persist into the nested named functions
    // further down (setupPeerConnection, etc.), even though `roomId`
    // itself is fixed for this whole effect instance.
    const currentRoomId = roomId
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh room starts with neither known yet, same as `status` below
    setRemoteStream(null)
    setMediaRoom(roomId)
    setRemoteVideoReady(false)
    setRtcInitialized(false)
    setConnectionFailed(false)

    let cancelled = false
    // Bumped every time a NEW RTCPeerConnection is created for this room —
    // the initial one, and (at most once — see freshRecoveryUsed below)
    // the fresh-connection recovery attempt. Every handler attached
    // directly to a SPECIFIC pc closes over its own `myGeneration` and
    // checks it against the live value before doing anything, so a late
    // event from an already-closed previous-generation pc can never affect
    // current room state — belt-and-suspenders on top of `pc.close()`
    // itself already stopping further events; see setupPeerConnection.
    let generation = 0
    // Bounds the fresh-connection recovery tier to exactly ONE attempt per
    // room, ever — never reset once used, even if the fresh connection
    // itself later needs (and gets) its own single ICE restart.
    let freshRecoveryUsed = false

    // ROOM-scoped (survive a fresh-connection recovery, unlike everything
    // declared inside setupPeerConnection below) — the persistent remote
    // MediaStream VideoTile's srcObject binds to exactly once, same as
    // before a fresh-connection recovery could ever happen: reused across
    // a fresh pc too, so a recovered call's video reattaches into the SAME
    // stream object (and the SAME <video> element binding) rather than
    // needing VideoTile to notice a brand new stream reference.
    const combinedRemoteStream = new MediaStream()
    let remoteStreamAttached = false

    // See RtcPhase's own doc comment above — purely diagnostic, logged
    // only, never returned/rendered.
    let phase: RtcPhase = "room-created"
    function setPhase(next: RtcPhase) {
      if (phase === next) return
      phase = next
      console.debug("webrtc: phase", { roomId, phase: next })
    }

    // PER-GENERATION — all reassigned fresh by setupPeerConnection() every
    // time a new RTCPeerConnection is created. tick()/checkSenderHealth()/
    // markVideoNotReady()/reportPlaybackConfirmedForThisRoom()/recover()
    // are each defined ONCE for this whole room effect and read these
    // through closure, so they always operate on whichever generation is
    // CURRENT without needing to be redefined per-generation themselves.
    let pc: RTCPeerConnection
    let negotiation: ReturnType<typeof createRtcNegotiation>
    let unsubscribeSignal: () => void = () => {}
    let collectStats: ReturnType<typeof makeStatsCollector>
    let recoveryStartedAt: number | null = null
    let recoveryBaseline = 0
    let lastDecodedFrames = 0
    let videoReadyLocal = false
    let remoteVideoTrackLive = false
    // Tracks how long the CURRENT generation's connection has been
    // "connected" per ICE/DTLS — the media-readiness timeout below
    // measures from here, independent of (and deliberately more skeptical
    // than) connectionState alone. Reset on every fresh generation.
    let connectedAt: number | null = null
    let disconnectedGraceTimer: ReturnType<typeof setTimeout> | null = null

    function clearDisconnectedGrace() {
      if (disconnectedGraceTimer) {
        clearTimeout(disconnectedGraceTimer)
        disconnectedGraceTimer = null
      }
    }

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
      setPhase("media-ready")
      setRemoteVideoReady(true)
      negotiation.recovered()
      recoveryStartedAt = null
    }
    reportPlaybackConfirmedRef.current = reportPlaybackConfirmedForThisRoom

    // Always acts on whichever generation's negotiation is CURRENT — see
    // this effect's own top comment on `negotiation` being a `let`.
    const recover = () => { void negotiation.recover() }

    // The disconnected-grace mechanism — see DISCONNECTED_GRACE_MS's own
    // doc comment for why `disconnected` gets a short window to self-
    // resolve before this schedules a real recovery attempt, while
    // `failed` (a terminal ICE state — nothing to wait out) recovers right
    // away. Re-checks the LIVE state when the grace window actually
    // elapses (not the state at the moment it was scheduled) so a
    // connection that already bounced back to healthy in the meantime
    // (which would have already cleared this timer via `clear-grace`
    // anyway) can never trigger a redundant recovery.
    function scheduleRecoveryCheck(immediate: boolean) {
      clearDisconnectedGrace()
      if (immediate) {
        recover()
        return
      }
      disconnectedGraceTimer = setTimeout(() => {
        disconnectedGraceTimer = null
        if (cancelled) return
        const stillUnhealthy =
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed"
        if (stillUnhealthy) recover()
      }, DISCONNECTED_GRACE_MS)
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

    // Closes and fully detaches the CURRENT generation's pc/negotiation/
    // signal-subscription/grace-timer — used both by the final effect
    // cleanup (room genuinely ending) and by attemptFreshConnectionRecovery
    // (this room continuing, just with a brand-new pc). Never touches
    // combinedRemoteStream/tickInterval/React state that's meant to
    // survive a fresh-connection swap.
    function teardownCurrentPeerConnection() {
      clearDisconnectedGrace()
      unsubscribeSignal()
      negotiation.dispose()
      pc.close()
    }

    // Builds one RTCPeerConnection generation — the initial one
    // (isFreshRecovery=false), or the single allowed fresh-connection
    // recovery attempt (isFreshRecovery=true, called only from
    // attemptFreshConnectionRecovery, only after teardownCurrentPeerConnection
    // has already closed the previous generation). Reuses videoTrackRef.
    // current/audioTrackRef.current (the SAME live camera/mic tracks —
    // getUserMedia is never called again here) and combinedRemoteStream
    // (the same remote MediaStream object) either way.
    function setupPeerConnection(isFreshRecovery: boolean) {
      generation += 1
      const myGeneration = generation

      // Explicit, not just the implicit default — "all" (never "relay")
      // means every candidate type is gathered and ICE's own priority
      // ordering (RFC 8445: host/srflx always outrank relay by type alone,
      // independent of anything below) is what actually picks a direct
      // path over TURN whenever one exists. TURN only ever gets used when
      // it's the only pair that actually connects — this is what makes it
      // a genuine fallback rather than a forced relay. buildIceServers()
      // is called fresh here (never a frozen module constant) so a
      // rotated short-lived TURN credential is always picked up by the
      // next pc this function ever creates, including a fresh-connection
      // recovery's own one.
      const iceServers = buildIceServers()
      if (process.env.NODE_ENV !== "production") {
        console.log(
          includesTurn(iceServers)
            ? "webrtc: TURN is configured for this connection attempt"
            : "webrtc: STUN-only — no TURN configured for this deployment; connections behind symmetric NAT/restrictive firewalls may fail",
          { roomId }
        )
      }
      const pcLocal = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" })
      pc = pcLocal
      pcRef.current = pcLocal
      console.log("webrtc: peer created", { roomId, initiator, isFreshRecovery })

      recoveryStartedAt = null
      recoveryBaseline = 0
      lastDecodedFrames = 0
      videoReadyLocal = false
      remoteVideoTrackLive = false
      connectedAt = null
      clearDisconnectedGrace()

      negotiation = createRtcNegotiation(pcLocal, initiator, (data) => sendSignal(currentRoomId, data), (event) => {
        if (generation !== myGeneration) return
        console.debug(`webrtc: ${event}`, { roomId })
        if (event === "offer sent") setPhase("offer-sent")
        else if (event === "offer received") setPhase("offer-received")
        else if (event === "answer sent") setPhase("answer-sent")
        else if (event === "answer received") setPhase("answer-received")
        if (event === "ICE restart started") {
          recoveryStartedAt = Date.now()
          recoveryBaseline = lastDecodedFrames
          videoReadyLocal = false
          setRemoteVideoReady(false)
        }
      })

      // A brand-new RTCPeerConnection was just created — this is resource
      // initialization, not mirroring some other piece of state. True for
      // a fresh-connection recovery too: the call genuinely is
      // reconnecting, and the UI should say so exactly like it would for
      // any other in-room recovery.
      setStatus("connecting")

      const videoTransceiver = pcLocal.addTransceiver("video", { direction: "sendrecv" })
      const audioTransceiver = pcLocal.addTransceiver("audio", { direction: "sendrecv" })
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

      // Reads videoTrackRef/audioTrackRef (kept live by the replaceTrack-
      // syncing effect further down), not the `videoTrack`/`audioTrack`
      // props directly — for a fresh-connection recovery this IS the
      // point: the exact same current camera/mic tracks this account was
      // already sending, reused as-is, never a fresh getUserMedia() call.
      if (videoTrackRef.current) {
        videoTransceiver.sender
          .replaceTrack(videoTrackRef.current)
          .catch((err) => console.error("webrtc: replaceTrack (initial video) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
      }
      // Muted-at-setup (e.g. a fresh match landed on right after a skip
      // made mid-mute, or a fresh-connection recovery happening while
      // already muted) must never briefly attach the real audio track
      // before some later effect gets around to detaching it again —
      // `micEnabledRef` already reflects the current mute state by the
      // time this runs, so the sender simply never receives a track to
      // begin with rather than attaching-then-immediately-removing one.
      if (audioTrackRef.current && micEnabledRef.current) {
        audioTransceiver.sender
          .replaceTrack(audioTrackRef.current)
          .catch((err) => console.error("webrtc: replaceTrack (initial audio) failed", { roomId, error: err instanceof Error ? err.name : "RTCError" }))
      }

      pcLocal.ontrack = (event) => {
        if (generation !== myGeneration) return
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

        // Merge into the ROOM's persistent stream (see its own doc
        // comment above) — replace any STALE track of the same kind
        // first (a renegotiation/ICE-restart/fresh-connection recovery
        // producing a new track for an existing kind), never just
        // accumulate duplicates.
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
          if (generation !== myGeneration) return
          console.log("webrtc: remote track ended", { roomId, kind: track.kind })
          if (track.kind === "video") markVideoNotReady("track ended")
        }
        track.onmute = () => {
          if (generation !== myGeneration) return
          console.log("webrtc: remote track muted (no data arriving)", { roomId, kind: track.kind })
          if (track.kind === "video") {
            remoteVideoTrackLive = false
            markVideoNotReady("track muted")
          }
        }
        track.onunmute = () => {
          if (generation !== myGeneration) return
          console.log("webrtc: remote track unmuted (data flowing)", { roomId, kind: track.kind })
          if (track.kind === "video") remoteVideoTrackLive = true
        }

        // Only ever set once per ROOM (combinedRemoteStream's own object
        // reference never changes across a fresh-connection recovery), not
        // once per generation — a fresh generation's own tracks merge into
        // the SAME stream React already has a reference to, so there's
        // nothing new to hand it.
        if (!remoteStreamAttached) {
          remoteStreamAttached = true
          setRemoteStream(combinedRemoteStream)
        }
      }

      pcLocal.onicecandidate = (event) => {
        if (generation !== myGeneration) return
        if (event.candidate) {
          // Tagged with THIS negotiation's own id — see RtcSignal's own
          // doc comment in lib/signaling/protocol.ts for why. Reads it
          // fresh from `negotiation` (not captured once at setup time)
          // since a non-initiator's own id starts null and is only
          // adopted once an offer actually arrives; `negotiation` itself
          // is this generation's own instance either way, never a stale
          // one (this handler is only ever attached to `pcLocal`, torn
          // down alongside it). A null id here (should not happen for a
          // healthy negotiation — ICE candidates only start flowing after
          // an offer/answer has already been created, which is exactly
          // what sets it) means there's nothing legitimate to tag this
          // candidate with, so it's dropped rather than sent unlabeled.
          const negotiationId = negotiation.getNegotiationId()
          if (!negotiationId) {
            console.error("webrtc: ICE candidate generated with no current negotiationId — dropping", { roomId })
            return
          }
          console.log("webrtc: ICE candidate", { roomId, type: event.candidate.type ?? "unknown" })
          sendSignal(currentRoomId, { kind: "ice", candidate: event.candidate.toJSON(), negotiationId })
        }
      }

      pcLocal.onicegatheringstatechange = () => {
        if (cancelled || generation !== myGeneration) return
        console.debug("webrtc: ICE gathering state", { roomId, state: pcLocal.iceGatheringState })
      }
      pcLocal.oniceconnectionstatechange = () => {
        if (cancelled || generation !== myGeneration) return
        console.debug("webrtc: ICE connection state", { roomId, state: pcLocal.iceConnectionState })
        if (pcLocal.iceConnectionState === "checking") setPhase("ice-connecting")
        const state =
          pcLocal.iceConnectionState === "connected" || pcLocal.iceConnectionState === "completed"
            ? "connected"
            : pcLocal.iceConnectionState === "disconnected"
              ? "disconnected"
              : pcLocal.iceConnectionState === "failed"
                ? "failed"
                : "other"
        const action = decideConnectionRecoveryAction(state)
        if (action === "clear-grace") clearDisconnectedGrace()
        else if (action === "recover-now") scheduleRecoveryCheck(true)
        else if (action === "grace-then-recover") scheduleRecoveryCheck(false)
      }
      pcLocal.onconnectionstatechange = () => {
        if (cancelled || generation !== myGeneration) return
        console.debug("webrtc: peer connection state", { roomId, state: pcLocal.connectionState })
        if (pcLocal.connectionState === "connected") {
          setPhase("connected")
          setStatus("connected")
          connectedAt = Date.now()
          clearDisconnectedGrace()
        } else {
          connectedAt = null
          setStatus(pcLocal.connectionState === "closed" ? "closed" : "connecting")
          markVideoNotReady("transport not connected")
          const state = pcLocal.connectionState === "disconnected" ? "disconnected" : pcLocal.connectionState === "failed" ? "failed" : "other"
          const action = decideConnectionRecoveryAction(state)
          if (action === "recover-now") scheduleRecoveryCheck(true)
          else if (action === "grace-then-recover") scheduleRecoveryCheck(false)
        }
      }

      collectStats = makeStatsCollector(pcLocal)

      unsubscribeSignal()
      unsubscribeSignal = onSignal(currentRoomId, (incomingRoomId, data) => {
        if (cancelled || generation !== myGeneration || incomingRoomId !== currentRoomId) return
        void negotiation.receive(data)
      })

      // Everything the room-establishment handshake actually needed is
      // true right here: the RTCPeerConnection exists, both transceivers
      // exist, and the signal listener for THIS room is now registered —
      // see "rtc-ready" in lib/signaling/protocol.ts for the exact bullet
      // list this satisfies. useMatchmaking.ts sends "rtc-ready" once this
      // AND its own remaining conditions (realtimeReady, a live local
      // video track) hold. Meaningful only the FIRST time (a
      // fresh-connection recovery doesn't repeat the handshake — see
      // below) but harmless to re-set either way.
      setRtcInitialized(true)

      if (isFreshRecovery) {
        setPhase("fresh-connection-recovery")
        // This room's own rtc-ready/rtc-start handshake already completed
        // once — a fresh-connection recovery renegotiates the SAME peer
        // immediately, it does not repeat that server round trip (the
        // non-initiator side is, as always, purely offer-reactive and
        // needs nothing further here). Any earlier startNegotiationRef
        // callback is now meaningless (its own `generation !== myGeneration`
        // guard would already no-op it), cleared anyway for clarity.
        startNegotiationRef.current = null
        if (initiator) {
          setPhase("rtc-start-received")
          void negotiation.start()
        }
      } else {
        setPhase("rtc-initialized")
        setPhase("waiting-for-peer-ready")
        // THE fix for "matched" alone never proving the other side would
        // ever actually receive an offer: negotiation.start() (the
        // initiator-only call that creates and sends the first SDP offer)
        // does not fire unconditionally the instant this runs — see
        // UseWebRTCParams' own doc comment on `rtcStart` for the full
        // reasoning. It only ever fires once the server's "rtc-start"
        // arrives (confirming BOTH sides are genuinely rtc-ready), via the
        // small separate effect further down that watches `rtcStart` and
        // calls through this ref — never as a dependency of THIS effect,
        // which would tear down and recreate the whole RTCPeerConnection
        // on every readiness-handshake tick. The non-initiator's own flow
        // is completely unaffected: it never called negotiation.start()
        // before and still doesn't — it only ever reacts to an incoming
        // offer via onSignal above.
        let negotiationStarted = false
        startNegotiationRef.current = () => {
          if (cancelled || negotiationStarted || !initiator || generation !== myGeneration) return
          negotiationStarted = true
          setPhase("rtc-start-received")
          void negotiation.start()
        }
      }
    }

    // The ONE additional recovery level above the existing bounded ICE
    // restart — see decideAfterIceRecoveryDeadline's own doc comment and
    // the tick() call site below for exactly when this runs. Reuses the
    // SAME current camera/mic tracks (never getUserMedia again), the SAME
    // combinedRemoteStream, the SAME room/roomId, and renegotiates the
    // SAME peer exactly once. Never leaves the old and new
    // RTCPeerConnection coexisting: teardownCurrentPeerConnection() always
    // fully closes the broken one, synchronously, before
    // setupPeerConnection() ever constructs the new one.
    function attemptFreshConnectionRecovery() {
      if (cancelled) return
      console.warn("webrtc: ICE restart did not recover in time — attempting one fresh RTCPeerConnection for this same room", { roomId })
      teardownCurrentPeerConnection()
      setupPeerConnection(true)
    }

    setupPeerConnection(false)

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
        const decision = decideAfterIceRecoveryDeadline(freshRecoveryUsed)
        if (decision === "attempt-fresh-connection") {
          freshRecoveryUsed = true
          attemptFreshConnectionRecovery()
        } else {
          console.error("webrtc: recovery exhausted (ICE restart, then a fresh connection) — giving up on this room", { roomId })
          setPhase("connection-failed")
          setConnectionFailed(true)
        }
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
          setPhase("media-ready")
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

    return () => {
      cancelled = true
      teardownCurrentPeerConnection()
      console.debug("webrtc: peer disposed", { roomId, reason: "room_effect_cleanup" })
      clearInterval(tickInterval)
      pcRef.current = null
      sendersRef.current = { video: null, audio: null }
      startNegotiationRef.current = null
      if (reportPlaybackConfirmedRef.current === reportPlaybackConfirmedForThisRoom) reportPlaybackConfirmedRef.current = null
      setStatus("closed")
      setRemoteStream(null)
      setRemoteVideoReady(false)
    }
    // videoTrack/audioTrack/micEnabled are deliberately never read directly
    // in this effect — only via videoTrackRef/audioTrackRef/micEnabledRef,
    // kept in sync by the replaceTrack-syncing effect below (and this
    // effect's own checkSenderHealth self-heal) — specifically so neither
    // one needs to be a dependency here, which would otherwise tear down
    // and recreate the whole RTCPeerConnection on every camera/mic toggle.
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

  // Watches the server's "rtc-start" (relayed through useMatchmaking.ts's
  // own `rtcStart`, already room-scoped there) and, the moment it becomes
  // true, triggers THIS room's own negotiation.start() via
  // startNegotiationRef — see startNegotiationForThisRoom's own doc
  // comment inside the room effect above for the full reasoning. Kept as
  // its own small effect, deliberately NOT folded into the room effect
  // itself: `rtcStart` flipping must never tear down and recreate the
  // RTCPeerConnection, only trigger an action on the one that already
  // exists. `startNegotiationForThisRoom` is itself idempotent (guards on
  // its own `negotiationStarted` flag) and a safe no-op once the room
  // effect has torn down (the ref is cleared to null in that cleanup), so
  // there's no meaningful failure mode from this firing more than once or
  // from a late/stale `rtcStart` value.
  useEffect(() => {
    if (rtcStart) startNegotiationRef.current?.()
  }, [rtcStart])

  return {
    remoteStream: mediaRoom === roomId ? remoteStream : null,
    remoteVideoReady: mediaRoom === roomId && remoteVideoReady,
    rtcInitialized: mediaRoom === roomId && rtcInitialized,
    // True once this room's tiered recovery (grace window -> bounded ICE
    // restart -> one fresh RTCPeerConnection) is genuinely exhausted — see
    // connectionFailed's own doc comment above. useMatchmaking.ts is what
    // actually leaves the room in response; this hook only ever reports
    // the fact.
    connectionFailed: mediaRoom === roomId && connectionFailed,
    status,
    reportPlaybackConfirmed,
  }
}
