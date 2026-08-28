import type { RtcSignal } from "./signaling/protocol"

// A sane ceiling on how many signals one room can buffer before a listener
// ever subscribes. A real negotiation is at most one offer/answer plus a
// modest handful of ICE candidates — dozens, not hundreds — so this is
// generous headroom for a genuinely slow subscribe, not a real limit on
// normal operation. Without a cap, a pathological case (a listener that
// never subscribes at all, e.g. a bug elsewhere) would let this grow
// unbounded for the lifetime of the room.
export const MAX_BUFFERED_SIGNALS_PER_ROOM = 64

/**
 * Per-room ordered backlog for realtime "signal" messages (WebRTC
 * offer/answer/ICE) that arrive before anything has subscribed to receive
 * them yet — a real, if narrow, race: React schedules useWebRTC's
 * subscription asynchronously after "matched" sets `roomId`, while the
 * partner's own offer can in principle arrive over the wire before that
 * effect has actually run. Without buffering, that signal just vanishes —
 * forEach over an empty listener set does nothing, silently — and
 * negotiation either never completes or has to wait out a full
 * stuck-connection timeout to recover via a skip.
 *
 * Deliberately framework-independent (no React) so it's unit-testable on
 * its own — see hooks/useMatchmaking.ts for how it's actually wired in.
 */
export class SignalBacklog {
  private byRoom = new Map<string, RtcSignal[]>()

  /** Buffers one signal for `roomId`, oldest-dropped if already at the cap — a cap exists specifically so a room that never gets subscribed to can't grow this forever; dropping the oldest (not refusing the newest) keeps whatever's most likely still relevant to a negotiation in progress. */
  push(roomId: string, signal: RtcSignal): void {
    const queued = this.byRoom.get(roomId) ?? []
    queued.push(signal)
    if (queued.length > MAX_BUFFERED_SIGNALS_PER_ROOM) queued.shift()
    this.byRoom.set(roomId, queued)
  }

  /** Delivers every buffered signal, across every room, to `deliver` in the order each room received them — a fresh subscriber doesn't know in advance which room(s) it cares about (see useWebRTC, which filters by roomId itself), so replaying everything and letting it self-filter is simpler and just as correct as trying to guess. Clears everything delivered this way. */
  drainAll(deliver: (roomId: string, signal: RtcSignal) => void): void {
    for (const [roomId, queued] of this.byRoom) {
      for (const signal of queued) deliver(roomId, signal)
    }
    this.byRoom.clear()
  }

  /** Discards whatever's buffered for one room — used when that room ends (skip, block, peer-left, disconnect, a new room replacing it) so a stale offer/candidate from a dead negotiation can never leak into a future one. */
  clear(roomId: string): void {
    this.byRoom.delete(roomId)
  }

  clearAll(): void {
    this.byRoom.clear()
  }

  /** Test/diagnostic helper — how many signals are currently buffered for one room. */
  sizeFor(roomId: string): number {
    return this.byRoom.get(roomId)?.length ?? 0
  }
}
