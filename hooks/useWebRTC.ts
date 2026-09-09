"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createRtcNegotiation } from "@/lib/rtcNegotiation"
import { decideConnectionRecoveryAction } from "@/lib/webrtcRecovery"
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
// remoteVideoReady's own two proofs (stats or playback — see its doc
// comment), so a restart that reconnects the transport but never actually
// gets video flowing again still counts as failed once this elapses.
const ICE_RESTART_DEADLINE_MS = 15_000

// One tick drives both readiness detection (see the stats-based proof in
// reportVideoReadyIfDecoding below) and checkSenderHealth's self-heal —
// fast enough that "connected" -> real video showing up doesn't feel
// laggy. Full diagnostic logging is throttled to every 5th tick (see
// LOG_EVERY_N_TICKS) so the console stays "a handful of log lines" at a
// roughly 5s cadence, not a firehose, while the readiness check itself
// stays responsive.
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

/**
 * Parses one getStats() report into the numbers this file needs — the
 * selected ICE candidate pair's type (host/srflx/relay) and transport
 * (udp/tcp), round-trip time, and both directions' video packet/frame/byte
 * counters. Most of this is diagnostic-only logging (candidate type, RTT,
 * bitrate); `incoming.framesDecoded` is the one field that IS load-bearing
 * — see reportVideoReadyIfDecoding below, one of the two independent
 * proofs "genuinely playing" can rest on. The other is real <video>
 * playback (reportPlaybackConfirmedForThisRoom) — two proofs, not one,
 * because neither is reliable on every browser on its own: some browsers
 * can decode real frames (this proof) while the <video> element itself is
 * slow to reach a "playing" state or never fires it reliably; recovery
 * itself is decided independently of both, solely by
 * connectionState/iceConnectionState (see decideConnectionRecoveryAction).
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
  /** The one allowed ICE restart didn't resolve this problem in time — see terminate() and ICE_RESTART_DEADLINE_MS. useMatchmaking.ts (via the `connectionFailed` return value) is what actually leaves the room from here. */
  | "connection-failed"

/**
 * Exactly ONE RTCPeerConnection per room, for the room's entire lifetime —
 * this is the whole architecture: `matched` -> create the pc, attach the
 * live camera/mic tracks -> "rtc-ready" -> the server confirms both sides
 * ready -> "rtc-start" tells the initiator to negotiate -> offer -> answer
 * -> trickle ICE -> ontrack -> genuine video playback -> active. A video
 * and audio transceiver are created up front (sendrecv, even before a
 * local track exists), so every camera/mic toggle or device switch
 * afterward is a plain `sender.replaceTrack()` call — never a
 * renegotiation.
 *
 * There is no automatic fresh-RTCPeerConnection recovery. A transport
 * problem gets exactly one ICE restart, on this SAME pc (see
 * DISCONNECTED_GRACE_MS/ICE_RESTART_DEADLINE_MS and
 * decideConnectionRecoveryAction below for the full state machine); if
 * that doesn't resolve it, the room is cleanly terminated
 * (`connectionFailed` becomes true) rather than retried — never a second
 * RTCPeerConnection, never a loop. This intentionally trades "recover from
 * absolutely everything automatically" for "simple, deterministic, and
 * easy to reason about" — see rtcInstanceId below for how to verify, from
 * the console alone, that a given room really only ever created one.
 */
export function useWebRTC({ roomId, initiator, videoTrack, audioTrack, micEnabled, rtcStart, sendSignal, onSignal }: UseWebRTCParams) {
  const [status, setStatus] = useState<PeerConnectionStatus>("new")
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sendersRef = useRef<{ video: RTCRtpSender | null; audio: RTCRtpSender | null }>({ video: null, audio: null })
  // Mirrors the latest videoTrack/audioTrack/micEnabled props for the room
  // effect's own closure to read without needing them in its dependency
  // array (which would tear down and recreate the RTCPeerConnection on
  // every camera toggle — see that effect's own trailing comment; the
  // whole point of "one pc for the room's entire lifetime" depends on
  // this never happening). Kept current by the replaceTrack-syncing effect
  // further down.
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
  // True once remote video is genuinely proven ready — by EITHER of two
  // independent proofs, never "ICE/DTLS says connected" alone (that can be
  // true with zero video ever actually rendering):
  //
  // 1. Stats proof (reportVideoReadyIfDecoding, the tick loop further
  //    down): a live remote video track has arrived AND getStats()
  //    confirms real frames are actually decoding.
  //
  // 2. Playback proof (reportPlaybackConfirmedForThisRoom below, called
  //    from VideoTile.tsx via useMatchmaking.ts): the peer's actual
  //    <video> element reached "playing", with a real track/stream
  //    attached and real decoded dimensions.
  //
  // Neither is reliable enough alone on every browser — some decode real
  // frames while the <video> element is slow to (or never reliably does)
  // reach "playing"; others can render correctly while framesDecoded stays
  // missing or delayed. Both write into this SAME state, so "active"
  // itself never needs to know which proof satisfied it, and both are
  // reset by the identical set of real WebRTC-level events
  // (markVideoNotReady, below). This is what useMatchmaking.ts's `state`
  // derivation gates "active" on, instead of `status === "connected"`
  // alone, so the matched-profile UI never shows over what would
  // otherwise be an empty peer tile.
  const [remoteVideoReady, setRemoteVideoReady] = useState(false)
  // Lets reportPlaybackConfirmed (below, and this hook's return value)
  // reach into whichever room-effect instance is CURRENTLY live, without
  // needing that effect's own internals (videoReadyLocal, cancelled, the
  // room's own `roomId` closure) as an external dependency. Reassigned
  // every time the room effect (re)runs, to that instance's own handler;
  // cleared to null on that instance's cleanup — so a call that arrives
  // after a room has genuinely ended, before any new one has started, is a
  // safe no-op instead of reaching into a torn-down closure.
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
  // would tear down and recreate the RTCPeerConnection every time the
  // server's readiness handshake progresses) reach into whichever room
  // effect instance is CURRENTLY live, mirroring reportPlaybackConfirmedRef's
  // exact pattern immediately above. Reassigned fresh by every room effect
  // instance; cleared to null on that instance's own cleanup.
  const startNegotiationRef = useRef<(() => void) | null>(null)
  // True once this room's ONE allowed recovery attempt has failed to fix
  // the connection within its own deadline (or the connection failed again
  // before it ever did) — see terminate() below and its own call sites.
  // useMatchmaking.ts watches this and is what actually leaves the room
  // from here (sends "leave", clears local state, decides random-resume
  // vs. idle exactly like an ordinary peer-left — see its own effect).
  // This hook's own job stops at reporting the fact and closing its pc via
  // the room effect's own cleanup (roomId clearing) — it never decides to
  // leave a room, or builds a replacement RTCPeerConnection, on its own.
  const [connectionFailed, setConnectionFailed] = useState(false)
  const [mediaRoom, setMediaRoom] = useState<string | null>(null)

  // Keeps the module-level ephemeral TURN credential warm for the whole
  // session — started once, independent of `roomId` (so it's very likely
  // already cached before this account's very first match, not fetched
  // lazily on demand), and reschedules itself before the current
  // credential's own expiry. See buildIceServers()/refreshTurnCredentials()
  // above for what actually consumes/produces this. Deliberately NOT part
  // of the room effect below — TURN credentials rotating must never tear
  // down or recreate the room's own RTCPeerConnection; only a genuinely
  // NEW pc (a new room, a skip) ever reads the current cache, via a fresh
  // buildIceServers() call.
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
    // `roomId` above doesn't persist into the nested closures further
    // down, even though `roomId` itself is fixed for this whole effect
    // instance.
    const currentRoomId = roomId
    // A fresh, per-effect-run id — logged alongside every diagnostic line
    // below purely so it's possible to confirm, straight from the
    // console, that a given room ever created exactly one RTCPeerConnection:
    // grep/filter the logs for one `rtcInstanceId` and there should be
    // exactly one "peer created" line and one uninterrupted lifecycle for
    // it. Carries no account identity, IP, or other sensitive information.
    const rtcInstanceId = crypto.randomUUID()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh room starts with neither known yet, same as `status` below
    setRemoteStream(null)
    setMediaRoom(roomId)
    setRemoteVideoReady(false)
    setRtcInitialized(false)
    setConnectionFailed(false)

    let cancelled = false
    // Once true, this room is done — no further recovery/termination logic
    // should act again while useMatchmaking.ts processes `connectionFailed`
    // and eventually clears `roomId` (which runs this effect's own
    // cleanup). Distinct from `cancelled`: `cancelled` means the EFFECT
    // itself tore down (roomId changed/component unmounted); `terminated`
    // means THIS still-live effect instance already gave up on recovery
    // and is just waiting to be torn down from the outside.
    let terminated = false

    const combinedRemoteStream = new MediaStream()
    let remoteStreamAttached = false

    // See RtcPhase's own doc comment above — purely diagnostic, logged
    // only, never returned/rendered.
    let phase: RtcPhase = "room-created"
    function setPhase(next: RtcPhase) {
      if (phase === next) return
      phase = next
      console.debug("webrtc: phase", { roomId, rtcInstanceId, phase: next })
    }

    let videoReadyLocal = false
    let remoteVideoTrackLive = false
    // The stats proof's own baseline — see reportVideoReadyIfDecoding
    // below. Reset (to whatever framesDecoded currently is) every time
    // readiness is lost, so the proof requires NEW frames decoding after
    // that point, never stale ones counted from before a track
    // ended/muted or an ICE restart began.
    let lastDecodedFrames = 0
    let decodedFramesBaseline = 0
    let disconnectedGraceTimer: ReturnType<typeof setTimeout> | null = null
    let recoveryDeadlineTimer: ReturnType<typeof setTimeout> | null = null

    function clearDisconnectedGrace() {
      if (disconnectedGraceTimer) {
        clearTimeout(disconnectedGraceTimer)
        disconnectedGraceTimer = null
      }
    }
    function clearRecoveryDeadline() {
      if (recoveryDeadlineTimer) {
        clearTimeout(recoveryDeadlineTimer)
        recoveryDeadlineTimer = null
      }
    }

    function markVideoNotReady(reason: string) {
      videoReadyLocal = false
      decodedFramesBaseline = lastDecodedFrames
      console.log("webrtc: remote video no longer ready", { roomId, rtcInstanceId, reason })
      setRemoteVideoReady(false)
    }

    // Cleanly ends this room's ONE allowed recovery attempt without ever
    // trying a second one or building a replacement RTCPeerConnection —
    // see this hook's own top doc comment for why. Does not itself close
    // the pc: useMatchmaking.ts reacts to `connectionFailed` by leaving
    // the room (sending "leave", clearing its own roomId), which runs this
    // effect's own cleanup below — the ONE place the pc is ever closed,
    // deterministically, for every way a room ends.
    function terminate(reason: string) {
      if (terminated) return
      terminated = true
      clearDisconnectedGrace()
      clearRecoveryDeadline()
      console.error("webrtc: recovery did not succeed — terminating this room", { roomId, rtcInstanceId, reason })
      setPhase("connection-failed")
      setConnectionFailed(true)
    }

    // `pc`/`negotiation` are declared with `const` further down, at their
    // one and only point of creation — the functions below close over
    // those bindings (referenced, not called, until well after that point)
    // exactly the way they'd close over any other later-declared const in
    // this same effect body.

    // Starts the room's ONE allowed ICE restart — see
    // lib/rtcNegotiation.ts's own recover()/recoveryAvailable() for the
    // one-shot bookkeeping this relies on. Bounded by
    // ICE_RESTART_DEADLINE_MS: if that elapses without
    // reportPlaybackConfirmedForThisRoom ever confirming real video is
    // flowing again, the room is terminated — never retried, never a
    // second RTCPeerConnection.
    function beginRecovery() {
      if (terminated) return
      console.log("webrtc: starting the one allowed ICE restart for this room", { roomId, rtcInstanceId })
      void negotiation.recover()
      clearRecoveryDeadline()
      recoveryDeadlineTimer = setTimeout(() => {
        recoveryDeadlineTimer = null
        if (cancelled || terminated) return
        negotiation.failed()
        terminate("the one allowed ICE restart did not resolve within its deadline")
      }, ICE_RESTART_DEADLINE_MS)
    }

    // The disconnected-grace mechanism — see DISCONNECTED_GRACE_MS's own
    // doc comment for why `disconnected` gets a short window to
    // self-resolve before this schedules a real recovery attempt, while
    // `failed` (a terminal ICE state — nothing to wait out) recovers right
    // away. Re-checks the LIVE state when the grace window actually
    // elapses (not the state at the moment it was scheduled) so a
    // connection that already bounced back to healthy in the meantime
    // (which would have already cleared this timer via `clear-grace`
    // anyway) can never trigger a redundant recovery.
    function scheduleRecoveryCheck(immediate: boolean) {
      clearDisconnectedGrace()
      if (immediate) {
        beginRecovery()
        return
      }
      disconnectedGraceTimer = setTimeout(() => {
        disconnectedGraceTimer = null
        if (cancelled || terminated) return
        const stillUnhealthy =
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed"
        if (stillUnhealthy) beginRecovery()
      }, DISCONNECTED_GRACE_MS)
    }

    // The playback-proof path — one of the two things that can set
    // remoteVideoReady true (see reportVideoReadyIfDecoding below for the
    // other). `forRoomId` is checked against this EFFECT INSTANCE's own
    // `roomId` (not a live/mutable value — this whole
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
      console.log("webrtc: remote video ready — confirmed by actual <video> playback", { roomId, rtcInstanceId })
      videoReadyLocal = true
      decodedFramesBaseline = lastDecodedFrames
      setPhase("media-ready")
      setRemoteVideoReady(true)
      negotiation.recovered()
      clearRecoveryDeadline()
    }
    reportPlaybackConfirmedRef.current = reportPlaybackConfirmedForThisRoom

    // The stats-proof path — the other of the two independent proofs (see
    // remoteVideoReady's own doc comment above for why both exist). Called
    // from the tick loop below with this generation's own latest
    // getStats() read: a live remote video track has arrived AND real
    // frames have decoded since the last reset (markVideoNotReady) —
    // either alone was the exact kind of false positive this whole
    // mechanism exists to rule out (ICE/DTLS "connected" with nothing
    // actually decoding).
    function reportVideoReadyIfDecoding(framesDecoded: number) {
      if (videoReadyLocal || !remoteVideoTrackLive || framesDecoded <= decodedFramesBaseline) return
      console.log("webrtc: remote video ready — live track + frames decoding", { roomId, rtcInstanceId, framesDecoded })
      videoReadyLocal = true
      setPhase("media-ready")
      setRemoteVideoReady(true)
      negotiation.recovered()
      clearRecoveryDeadline()
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
          rtcInstanceId,
          senderHasTrack: Boolean(video.track),
          expectedTrack: Boolean(videoTrackRef.current),
        })
        video
          .replaceTrack(videoTrackRef.current)
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (video) failed", { roomId, rtcInstanceId, error: err instanceof Error ? err.name : "RTCError" }))
      }
      // The "correct" audio track is null while muted, not
      // audioTrackRef.current — see micEnabled's own doc comment on
      // UseWebRTCParams. Without this, self-heal would fight the mute
      // itself: every check, it would see the sender's track (null,
      // because the mute effect below deliberately detached it) not
      // matching audioTrackRef.current (the real mic track) and "fix"
      // that by reattaching it, undoing the mute.
      const desiredAudioTrack = micEnabledRef.current ? audioTrackRef.current : null
      if (audio && audio.track !== desiredAudioTrack) {
        console.error("webrtc: audio sender's track doesn't match what it should be (mic track, or null while muted) — reapplying replaceTrack", {
          roomId,
          rtcInstanceId,
          senderHasTrack: Boolean(audio.track),
          expectedTrack: Boolean(desiredAudioTrack),
          micEnabled: micEnabledRef.current,
        })
        audio
          .replaceTrack(desiredAudioTrack)
          .catch((err) => console.error("webrtc: sender self-heal replaceTrack (audio) failed", { roomId, rtcInstanceId, error: err instanceof Error ? err.name : "RTCError" }))
      }
    }

    // Explicit, not just the implicit default — "all" (never "relay")
    // means every candidate type is gathered and ICE's own priority
    // ordering (RFC 8445: host/srflx always outrank relay by type alone,
    // independent of anything below) is what actually picks a direct
    // path over TURN whenever one exists. TURN only ever gets used when
    // it's the only pair that actually connects — this is what makes it
    // a genuine fallback rather than a forced relay.
    const iceServers = buildIceServers()
    if (process.env.NODE_ENV !== "production") {
      console.log(
        includesTurn(iceServers)
          ? "webrtc: TURN is configured for this connection attempt"
          : "webrtc: STUN-only — no TURN configured for this deployment; connections behind symmetric NAT/restrictive firewalls may fail",
        { roomId, rtcInstanceId }
      )
    }
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" })
    pcRef.current = pc
    console.log("webrtc: peer created", { roomId, rtcInstanceId, initiator })

    const negotiation = createRtcNegotiation(pc, initiator, (data) => sendSignal(currentRoomId, data), (event) => {
      if (cancelled) return
      console.debug(`webrtc: ${event}`, { roomId, rtcInstanceId })
      if (event === "offer sent") setPhase("offer-sent")
      else if (event === "offer received") setPhase("offer-received")
      else if (event === "answer sent") setPhase("answer-sent")
      else if (event === "answer received") setPhase("answer-received")
    })

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
        rtcInstanceId,
        error: err instanceof Error ? err.name : "RTCError",
      })
    }

    // Reads videoTrackRef/audioTrackRef (kept live by the replaceTrack-
    // syncing effect further down), not the `videoTrack`/`audioTrack`
    // props directly — the same live camera/mic tracks the rest of the UI
    // is already using, never a fresh getUserMedia() call.
    if (videoTrackRef.current) {
      videoTransceiver.sender
        .replaceTrack(videoTrackRef.current)
        .catch((err) => console.error("webrtc: replaceTrack (initial video) failed", { roomId, rtcInstanceId, error: err instanceof Error ? err.name : "RTCError" }))
    }
    // Muted-at-setup (e.g. a fresh match landed on right after a skip made
    // mid-mute) must never briefly attach the real audio track before some
    // later effect gets around to detaching it again — `micEnabledRef`
    // already reflects the current mute state by the time this runs, so
    // the sender simply never receives a track to begin with rather than
    // attaching-then-immediately-removing one.
    if (audioTrackRef.current && micEnabledRef.current) {
      audioTransceiver.sender
        .replaceTrack(audioTrackRef.current)
        .catch((err) => console.error("webrtc: replaceTrack (initial audio) failed", { roomId, rtcInstanceId, error: err instanceof Error ? err.name : "RTCError" }))
    }

    pc.ontrack = (event) => {
      if (cancelled) return
      const track = event.track
      console.log("webrtc: ontrack fired", {
        roomId,
        rtcInstanceId,
        kind: track.kind,
        readyState: track.readyState,
        muted: track.muted,
      })

      // Merge into the room's persistent remote stream — replace any
      // stale track of the same kind first (an ICE restart producing a
      // new track for an existing kind), never just accumulate
      // duplicates.
      for (const existing of track.kind === "video" ? combinedRemoteStream.getVideoTracks() : combinedRemoteStream.getAudioTracks()) {
        if (existing !== track) combinedRemoteStream.removeTrack(existing)
      }
      if (!combinedRemoteStream.getTracks().includes(track)) {
        combinedRemoteStream.addTrack(track)
      }

      if (track.kind === "video") {
        remoteVideoTrackLive = track.readyState === "live"
        console.log("webrtc: combined remote stream now has a video track", {
          roomId,
          rtcInstanceId,
          videoTrackCount: combinedRemoteStream.getVideoTracks().length,
          audioTrackCount: combinedRemoteStream.getAudioTracks().length,
        })
      }

      track.onended = () => {
        if (cancelled) return
        console.log("webrtc: remote track ended", { roomId, rtcInstanceId, kind: track.kind })
        if (track.kind === "video") markVideoNotReady("track ended")
      }
      track.onmute = () => {
        if (cancelled) return
        console.log("webrtc: remote track muted (no data arriving)", { roomId, rtcInstanceId, kind: track.kind })
        if (track.kind === "video") {
          remoteVideoTrackLive = false
          markVideoNotReady("track muted")
        }
      }
      track.onunmute = () => {
        if (cancelled) return
        console.log("webrtc: remote track unmuted (data flowing)", { roomId, rtcInstanceId, kind: track.kind })
        if (track.kind === "video") remoteVideoTrackLive = true
      }

      if (!remoteStreamAttached) {
        remoteStreamAttached = true
        setRemoteStream(combinedRemoteStream)
      }
    }

    pc.onicecandidate = (event) => {
      if (cancelled) return
      if (event.candidate) {
        console.log("webrtc: ICE candidate", { roomId, rtcInstanceId, type: event.candidate.type ?? "unknown" })
        sendSignal(currentRoomId, { kind: "ice", candidate: event.candidate.toJSON() })
      }
    }

    pc.onicegatheringstatechange = () => {
      if (cancelled) return
      console.debug("webrtc: ICE gathering state", { roomId, rtcInstanceId, state: pc.iceGatheringState })
    }
    pc.oniceconnectionstatechange = () => {
      if (cancelled) return
      console.debug("webrtc: ICE connection state", { roomId, rtcInstanceId, state: pc.iceConnectionState })
      if (pc.iceConnectionState === "checking") setPhase("ice-connecting")
      const state =
        pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed"
          ? "connected"
          : pc.iceConnectionState === "disconnected"
            ? "disconnected"
            : pc.iceConnectionState === "failed"
              ? "failed"
              : "other"
      const action = decideConnectionRecoveryAction(state, !negotiation.recoveryAvailable())
      if (action === "clear-grace") clearDisconnectedGrace()
      else if (action === "recover-now") scheduleRecoveryCheck(true)
      else if (action === "grace-then-recover") scheduleRecoveryCheck(false)
      else if (action === "terminate") terminate("ICE connection failed again with the one allowed restart already used")
    }
    pc.onconnectionstatechange = () => {
      if (cancelled) return
      console.debug("webrtc: peer connection state", { roomId, rtcInstanceId, state: pc.connectionState })
      if (pc.connectionState === "connected") {
        setPhase("connected")
        setStatus("connected")
        clearDisconnectedGrace()
      } else {
        setStatus(pc.connectionState === "closed" ? "closed" : "connecting")
        markVideoNotReady("transport not connected")
        const state = pc.connectionState === "disconnected" ? "disconnected" : pc.connectionState === "failed" ? "failed" : "other"
        const action = decideConnectionRecoveryAction(state, !negotiation.recoveryAvailable())
        if (action === "recover-now") scheduleRecoveryCheck(true)
        else if (action === "grace-then-recover") scheduleRecoveryCheck(false)
        else if (action === "terminate") terminate("connection failed again with the one allowed restart already used")
      }
    }

    const unsubscribeSignal = onSignal(currentRoomId, (incomingRoomId, data) => {
      if (cancelled || incomingRoomId !== currentRoomId) return
      void negotiation.receive(data)
    })

    // Everything the room-establishment handshake actually needed is true
    // right here: the RTCPeerConnection exists, both transceivers exist,
    // and the signal listener for THIS room is now registered — see
    // "rtc-ready" in lib/signaling/protocol.ts for the exact bullet list
    // this satisfies. useMatchmaking.ts sends "rtc-ready" once this AND
    // its own remaining conditions (realtimeReady, a live local video
    // track) hold.
    setRtcInitialized(true)
    setPhase("rtc-initialized")
    setPhase("waiting-for-peer-ready")

    // negotiation.start() (the initiator-only call that creates and sends
    // the first SDP offer) does not fire unconditionally the instant this
    // runs — see UseWebRTCParams' own doc comment on `rtcStart`. It only
    // ever fires once the server's "rtc-start" arrives (confirming BOTH
    // sides are genuinely rtc-ready), via the small separate effect
    // further down that watches `rtcStart` and calls through this ref —
    // never as a dependency of THIS effect, which would tear down and
    // recreate the RTCPeerConnection every time the readiness handshake
    // progresses. The non-initiator's own flow is unaffected: it never
    // calls negotiation.start() — it only ever reacts to an incoming offer
    // via onSignal above.
    let negotiationStarted = false
    startNegotiationRef.current = () => {
      if (cancelled || negotiationStarted || !initiator) return
      negotiationStarted = true
      setPhase("rtc-start-received")
      void negotiation.start()
    }

    // One tick drives three unrelated things at once: (1) the stats proof
    // of readiness (reportVideoReadyIfDecoding — see remoteVideoReady's
    // own doc comment for why this exists alongside playback proof, not
    // instead of it), (2) checkSenderHealth's self-heal, and (3)
    // throttled diagnostic logging of the full stats snapshot (every
    // LOG_EVERY_N_TICKS'th tick). None of this drives recovery — recovery
    // is decided solely by connectionState/iceConnectionState (see
    // pc.onconnectionstatechange/oniceconnectionstatechange above).
    const collectStats = makeStatsCollector(pc)
    let tickCount = 0
    let collecting = false
    const tickInterval = setInterval(() => {
      if (cancelled || collecting) return
      collecting = true
      tickCount += 1
      void collectStats().then((stats) => {
        collecting = false
        if (cancelled) return
        checkSenderHealth()
        if (!stats) return
        lastDecodedFrames = stats.incoming.framesDecoded ?? 0
        reportVideoReadyIfDecoding(lastDecodedFrames)
        if (tickCount % LOG_EVERY_N_TICKS === 0) {
          console.log("webrtc: stats", { roomId, rtcInstanceId, ...stats })
        }
      })
    }, TICK_INTERVAL_MS)

    return () => {
      cancelled = true
      clearDisconnectedGrace()
      clearRecoveryDeadline()
      clearInterval(tickInterval)
      unsubscribeSignal()
      negotiation.dispose()
      pc.close()
      console.debug("webrtc: peer disposed", { roomId, rtcInstanceId, reason: "room_effect_cleanup" })
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
    // and recreate the RTCPeerConnection on every camera/mic toggle. This
    // is what "never let any effect dependency recreate the pc while
    // roomId is unchanged" actually means in code: the dependency array
    // below only ever changes when the room itself genuinely changes.
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
  // startNegotiationRef. Kept as its own small effect, deliberately NOT
  // folded into the room effect itself: `rtcStart` flipping must never
  // tear down and recreate the RTCPeerConnection, only trigger an action
  // on the one that already exists. The ref callback is itself idempotent
  // (guards on its own `negotiationStarted` flag) and a safe no-op once
  // the room effect has torn down (the ref is cleared to null in that
  // cleanup), so there's no meaningful failure mode from this firing more
  // than once or from a late/stale `rtcStart` value.
  useEffect(() => {
    if (rtcStart) startNegotiationRef.current?.()
  }, [rtcStart])

  return {
    remoteStream: mediaRoom === roomId ? remoteStream : null,
    remoteVideoReady: mediaRoom === roomId && remoteVideoReady,
    rtcInitialized: mediaRoom === roomId && rtcInitialized,
    // True once this room's ONE allowed recovery attempt has genuinely
    // failed — see connectionFailed's own doc comment above.
    // useMatchmaking.ts is what actually leaves the room in response; this
    // hook only ever reports the fact.
    connectionFailed: mediaRoom === roomId && connectionFailed,
    status,
    reportPlaybackConfirmed,
  }
}
