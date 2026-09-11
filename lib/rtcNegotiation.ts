import type { RtcSignal } from "./signaling/protocol"

/**
 * One serialized SDP pipeline for a room's single, entire-lifetime
 * RTCPeerConnection (see hooks/useWebRTC.ts — one room ever creates exactly
 * one RTCPeerConnection; there is no fresh-connection recovery tier to
 * negotiate around). Only the designated initiator ever creates offers —
 * fixed roles eliminate glare entirely.
 *
 * No negotiationId/generation bookkeeping is needed here, on purpose: an
 * earlier version of this file had to prove which RTCPeerConnection
 * "generation" a signal belonged to, because fresh-connection recovery
 * meant a room could have more than one RTCPeerConnection over its
 * lifetime, and a late signal from an already-abandoned one had to be
 * caught. With exactly one RTCPeerConnection per room, ever, that concern
 * doesn't exist: a signal that reaches this instance at all is already
 * known to be for THIS negotiation. Room-level staleness (a signal for a
 * room that's already ended) is a separate, still-necessary layer, handled
 * upstream by useMatchmaking.ts's own per-room signal routing before this
 * is ever called.
 *
 * Recovery is bounded to ONE ICE restart for this room's lifetime.
 * Completing a restart does not replenish the budget. Later failures end
 * the room; only an explicit new room gets a new peer and restart budget.
 */
export function createRtcNegotiation(
  pc: RTCPeerConnection,
  initiator: boolean,
  send: (signal: RtcSignal) => void,
  log: (event: string) => void,
) {
  let disposed = false
  let chain = Promise.resolve()
  let recoveryUsed = false
  let recoveryPending = false
  let restartNegotiated = false
  let lastOffer = ""
  let lastAnswer = ""
  let candidates: RTCIceCandidateInit[] = []
  let restartRequested = false

  const enqueue = (work: () => Promise<void>) => {
    chain = chain.then(async () => { if (!disposed) await work() }).catch(() => {
      if (!disposed) log(recoveryPending ? "ICE restart failed" : "negotiation failed")
    })
    return chain
  }
  const alive = () => !disposed && pc.signalingState !== "closed"
  const applicable = (candidate: RTCIceCandidateInit) => !!pc.remoteDescription &&
    (!candidate.usernameFragment || pc.remoteDescription.sdp?.includes(`a=ice-ufrag:${candidate.usernameFragment}`))
  async function flush() {
    const pending = candidates
    candidates = []
    for (const candidate of pending) {
      if (!alive()) return
      if (!applicable(candidate)) { candidates.push(candidate); continue }
      try { await pc.addIceCandidate(candidate) } catch { log("ICE candidate rejected") }
    }
  }
  async function offer(restart: boolean) {
    if (!alive() || !initiator || pc.signalingState !== "stable") return
    if (restart) restartNegotiated = false
    const description = await pc.createOffer(restart ? { iceRestart: true } : undefined)
    if (!alive()) return
    await pc.setLocalDescription(description)
    if (!alive()) return
    send({ kind: "offer", sdp: pc.localDescription?.sdp ?? description.sdp ?? "" })
    log(restart ? "restart offer sent" : "offer sent")
  }
  async function maybeRestart() {
    if (!restartRequested || pc.signalingState !== "stable") return
    restartRequested = false
    await offer(true)
  }
  /** One serialized restart on this same peer; never replenish its budget. */
  function recover() {
    if (disposed || recoveryUsed) return chain
    recoveryUsed = true
    recoveryPending = true
    restartNegotiated = false
    log("ICE restart started")
    return enqueue(async () => {
      if (initiator) {
        restartRequested = true
        await maybeRestart()
      } else {
        send({ kind: "ice-restart-request" })
      }
    })
  }
  return {
    start: () => enqueue(() => offer(false)),
    recover,
    /** True only before this room has used its restart. */
    recoveryAvailable: () => !disposed && !recoveryUsed,
    receive: (data: RtcSignal) => {
      if (data.kind === "ice-restart-request") {
        return initiator ? recover() : chain
      }
      return enqueue(async () => {
        if (data.kind === "offer") {
          // Fixed roles eliminate glare; duplicate SDP must not re-answer.
          if (initiator || data.sdp === lastOffer || pc.signalingState !== "stable") return
          if (lastOffer && recoveryUsed && !recoveryPending) { log("ICE restart failed"); return }
          log("offer received")
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp })
          if (!alive()) return
          // A genuinely new offer after the first (the initiator's own
          // ICE restart) is this side's own equivalent of `recover()`
          // starting — same one-shot bookkeeping, so a second one
          // overlapping the first is still caught.
          if (lastOffer && !recoveryPending) {
            recoveryPending = true
            recoveryUsed = true
            log("ICE restart started")
          }
          lastOffer = data.sdp
          await flush()
          if (!alive()) return
          const answer = await pc.createAnswer()
          if (!alive()) return
          await pc.setLocalDescription(answer)
          if (!alive()) return
          if (recoveryPending) restartNegotiated = true
          send({ kind: "answer", sdp: pc.localDescription?.sdp ?? answer.sdp ?? "" })
          log("answer sent")
        } else if (data.kind === "answer") {
          if (!initiator || data.sdp === lastAnswer || pc.signalingState !== "have-local-offer") return
          log("answer received")
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
          if (!alive()) return
          if (recoveryPending) restartNegotiated = true
          lastAnswer = data.sdp
          await flush()
          await maybeRestart()
        } else if (data.kind === "ice") {
          candidates.push(data.candidate)
          if (candidates.length > 64) candidates.shift()
          await flush()
        }
      })
    },
    /** Called once real video proves the connection genuinely works again — see hooks/useWebRTC.ts's reportPlaybackConfirmedForThisRoom. Completes the attempt without replenishing the room’s one-restart budget. */
    recovered: () => {
      // Old media may keep playing while the restart offer is in flight.
      // It must not consume the deadline before that exchange completes.
      if (recoveryPending && (!restartNegotiated || pc.signalingState !== "stable" || restartRequested)) return false
      if (recoveryPending) log("ICE restart completed")
      recoveryPending = false
      return true
    },
    /** Called once hooks/useWebRTC.ts's own restart deadline elapses without recovering — leaves `recoveryUsed` set (never retried for this same problem; see recover()'s own doc comment) and only logs. */
    failed: () => {
      if (recoveryPending) log("ICE restart failed")
      recoveryPending = false
    },
    dispose: () => { disposed = true; candidates = [] },
  }
}
