import type { RtcSignal } from "./signaling/protocol"

/** One serialized SDP pipeline per room. Only the designated initiator offers.
 * Recovery is bounded to one attempt until new decoded video proves recovery.
 * No timers, automatic skip, SDP/candidate/address logging, or browser globals
 * beyond crypto.randomUUID() (see currentNegotiationId's own doc comment —
 * opaque, never identifying).
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

  /**
   * Proves which negotiation a signal belongs to — see RtcSignal's own doc
   * comment in lib/signaling/protocol.ts for why the local `generation`
   * counter useWebRTC.ts already keeps (which only guards a side's own
   * stale callbacks from its OWN already-closed RTCPeerConnection) isn't
   * enough on its own: it has no shared meaning with the peer, so it can't
   * catch a late signal describing the PEER's own already-abandoned
   * negotiation. One createRtcNegotiation() instance == one negotiation ==
   * one RTCPeerConnection generation (useWebRTC.ts creates a fresh
   * instance for the initial connection AND for its one allowed
   * fresh-connection recovery attempt, never reuses one across a pc swap).
   *
   * The INITIATOR mints this once, immediately, right when this instance
   * is created — every offer/ICE-candidate/ICE-restart-request it ever
   * sends through THIS instance carries it, including through an in-place
   * ICE restart (offer({iceRestart:true})): that's still the SAME
   * underlying negotiation, just with fresh ICE credentials, not a new
   * one, so it deliberately reuses the same id rather than minting a
   * fresh one.
   *
   * The NON-INITIATOR starts with none and ADOPTS whichever id the most
   * recently accepted offer declares (see receive()'s "offer" branch).
   * This is also what correctly handles the initiator's own
   * fresh-connection-recovery offer arriving at a non-initiator whose OWN
   * RTCPeerConnection was never recreated — from THAT side's point of
   * view, it's simply "another offer, with a new id", answered the exact
   * same way any other offer is.
   */
  let currentNegotiationId: string | null = initiator ? crypto.randomUUID() : null

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
    if (!alive() || !initiator || pc.signalingState !== "stable" || !currentNegotiationId) return
    const description = await pc.createOffer(restart ? { iceRestart: true } : undefined)
    if (!alive()) return
    await pc.setLocalDescription(description)
    if (!alive()) return
    send({ kind: "offer", sdp: pc.localDescription?.sdp ?? description.sdp ?? "", negotiationId: currentNegotiationId })
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
      } else if (currentNegotiationId) {
        send({ kind: "ice-restart-request", negotiationId: currentNegotiationId })
      }
    })
  }
  return {
    start: () => enqueue(() => offer(false)),
    recover,
    /**
     * Called ONLY by a non-initiator, ONLY right after ITS OWN
     * fresh-connection recovery has built a brand-new RTCPeerConnection
     * for this room (see hooks/useWebRTC.ts's attemptFreshConnectionRecovery)
     * — the architectural gap this closes: only the initiator ever
     * creates offers, so a non-initiator's own fresh pc otherwise has NO
     * path to ever get negotiated at all. The initiator's own connection
     * may be perfectly healthy the whole time and has no reason to know
     * anything happened on the other side — this is what tells it.
     * Unconditional, never bounded by recoveryUsed: the CALLER
     * (attemptFreshConnectionRecovery) is already itself bounded to one
     * fresh-connection attempt per room, and this isn't restarting the
     * OLD negotiation anyway — see receive()'s own handling of
     * "fresh-negotiation-request" for why it mints an entirely new
     * negotiationId rather than reusing anything.
     */
    requestFreshNegotiation: () => {
      if (initiator) return chain // only a non-initiator ever needs this
      return enqueue(async () => { send({ kind: "fresh-negotiation-request" }) })
    },
    /**
     * The negotiationId this instance is currently using to tag/validate
     * signals — null only for a non-initiator that hasn't adopted one
     * from an offer yet. Read by hooks/useWebRTC.ts to tag its OWN
     * directly-sent ICE candidates (pc.onicecandidate fires outside this
     * module — it isn't routed through this file's own `send`).
     */
    getNegotiationId: () => currentNegotiationId,
    receive: (data: RtcSignal) => {
      if (data.kind === "ice-restart-request") {
        // Only ever meaningful to the initiator (the non-initiator is the
        // one that SENDS this); the initiator's own negotiationId is
        // fixed at creation time, never adopted from anything, so this
        // check is safe to make synchronously, before the serialized
        // chain even matters here.
        if (data.negotiationId !== currentNegotiationId) return chain
        return initiator ? recover() : chain
      }
      if (data.kind === "fresh-negotiation-request") {
        // Only ever meaningful to the initiator — see
        // requestFreshNegotiation's own doc comment for who sends this
        // and why. The peer's OWN RTCPeerConnection is entirely new, so
        // this is genuinely a fresh negotiation from scratch, never a
        // restart of the old one: mint a brand new negotiationId (the
        // peer's fresh pc has none of its own yet — that's the entire
        // problem this solves) and clear every piece of the OLD
        // negotiation's recovery bookkeeping, deliberately bypassing
        // recoveryUsed's normal one-shot bound — that budget belonged to
        // recovering THIS side's still-existing pc against the OLD
        // negotiation, not to negotiating the peer's already-new one.
        if (!initiator) return chain
        return enqueue(async () => {
          if (!alive()) return
          currentNegotiationId = crypto.randomUUID()
          recoveryUsed = false
          recoveryPending = false
          restartRequested = false
          lastAnswer = ""
          lastOffer = ""
          log("fresh negotiation requested by peer")
          // Deliberately does NOT go through offer()'s own
          // signalingState === "stable" guard — this side may well still
          // be sitting in "have-local-offer" (e.g. an earlier restart
          // offer whose answer will now never come, because the peer's
          // pc that would have answered it is already gone) at exactly
          // the moment this arrives. That state describes a negotiation
          // the peer has already abandoned, not a real in-flight
          // exchange worth respecting — proceeding unconditionally is
          // what actually lets this side ever answer the peer's brand
          // new RTCPeerConnection instead of silently no-op'ing forever
          // because of a stale precondition. iceRestart: true still
          // mints fresh ICE credentials on THIS side's own (unchanged)
          // pc, matching the peer's genuinely new one.
          const description = await pc.createOffer({ iceRestart: true })
          if (!alive()) return
          await pc.setLocalDescription(description)
          if (!alive()) return
          send({ kind: "offer", sdp: pc.localDescription?.sdp ?? description.sdp ?? "", negotiationId: currentNegotiationId })
          log("fresh offer sent")
        })
      }
      return enqueue(async () => {
        if (data.kind === "offer") {
          // Fixed roles eliminate glare; duplicate SDP must not re-answer.
          if (initiator || data.sdp === lastOffer || pc.signalingState !== "stable") return
          // A genuinely new negotiationId (the very first offer ever, or
          // the initiator's own fresh-connection-recovery offer) is
          // always adopted as current — see currentNegotiationId's own
          // doc comment for why that's correct even when THIS side's own
          // RTCPeerConnection was never recreated to match.
          currentNegotiationId = data.negotiationId
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
          send({ kind: "answer", sdp: pc.localDescription?.sdp ?? answer.sdp ?? "", negotiationId: currentNegotiationId })
          log("answer sent")
        } else if (data.kind === "answer") {
          if (!initiator || data.negotiationId !== currentNegotiationId || data.sdp === lastAnswer || pc.signalingState !== "have-local-offer") return
          log("answer received")
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp })
          if (!alive()) return
          lastAnswer = data.sdp
          await flush()
          await maybeRestart()
        } else if (data.kind === "ice") {
          // A candidate belonging to a negotiation this side doesn't
          // currently recognize (an obsolete one from the peer's own
          // already-abandoned negotiation, or one that's simply arrived
          // with no matching offer/answer ever received) is discarded
          // outright — never buffered, never applied. One that DOES
          // match the current negotiation but arrives before the
          // matching remote description exists is still buffered by the
          // EXISTING applicable()/flush() mechanism below, unchanged —
          // this is a strictly earlier, stricter filter on top of it, not
          // a replacement for it.
          if (data.negotiationId !== currentNegotiationId) {
            log("ICE candidate discarded — stale negotiation")
            return
          }
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
