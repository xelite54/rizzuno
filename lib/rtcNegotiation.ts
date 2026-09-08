import type { RtcSignal } from "./signaling/protocol"

/** One serialized SDP pipeline per room. Only the designated initiator offers.
 * Recovery is bounded to one attempt until new decoded video proves recovery.
 * No timers, automatic skip, SDP/candidate/address logging, or browser globals.
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
  function recover() {
    if (disposed || recoveryUsed) return chain
    recoveryUsed = true
    recoveryPending = true
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
    receive: (data: RtcSignal) => {
      if (data.kind === "ice-restart-request") return initiator ? recover() : chain
      return enqueue(async () => {
        if (data.kind === "offer") {
          // Fixed roles eliminate glare; duplicate SDP must not re-answer.
          if (initiator || data.sdp === lastOffer || pc.signalingState !== "stable") return
          log("offer received")
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp })
          if (!alive()) return
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
          send({ kind: "answer", sdp: pc.localDescription?.sdp ?? answer.sdp ?? "" })
          log("answer sent")
        } else if (data.kind === "answer") {
          if (!initiator || data.sdp === lastAnswer || pc.signalingState !== "have-local-offer") return
          log("answer received")
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
          if (!alive()) return
          lastAnswer = data.sdp
          await flush()
          await maybeRestart()
        } else if (data.kind === "ice") {
          // Includes candidates from the next ICE generation arriving before
          // its SDP. Limit memory, but never apply them to the old credentials.
          candidates.push(data.candidate)
          if (candidates.length > 64) candidates.shift()
          await flush()
        }
      })
    },
    recovered: () => {
      if (recoveryPending) log("ICE restart completed")
      recoveryPending = false
      recoveryUsed = false
    },
    failed: () => {
      if (recoveryPending) log("ICE restart failed")
      recoveryPending = false
      // Keep the budget spent until actual video resumes; no retry loop.
    },
    dispose: () => { disposed = true; candidates = [] },
  }
}
