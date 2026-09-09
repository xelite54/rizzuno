import { test } from "node:test"
import assert from "node:assert/strict"
import { createRtcNegotiation } from "../lib/rtcNegotiation"
import type { RtcSignal } from "../lib/signaling/protocol"

// Protocol/state-machine doubles, NOT browser ICE/DTLS/media tests.
function fixture(initiator: boolean) {
  const calls: string[] = []
  const sent: RtcSignal[] = []
  let generation = 0
  const pc = {
    signalingState: "stable",
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    async createOffer(options?: RTCOfferOptions) {
      calls.push(options?.iceRestart ? "restart-offer" : "initial-offer")
      return { type: "offer", sdp: `offer-${++generation}` }
    },
    async createAnswer() { calls.push("create-answer"); return { type: "answer", sdp: `answer-${generation++}` } },
    async setLocalDescription(d: RTCSessionDescriptionInit) {
      calls.push(`local-${d.type}`)
      this.localDescription = d
      this.signalingState = d.type === "offer" ? "have-local-offer" : "stable"
    },
    async setRemoteDescription(d: RTCSessionDescriptionInit) {
      calls.push(`remote-${d.type}`)
      this.remoteDescription = d
      this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable"
    },
    async addIceCandidate() { assert.ok(this.remoteDescription); calls.push("candidate") },
  }
  const negotiation = createRtcNegotiation(pc as unknown as RTCPeerConnection, initiator, s => sent.push(s), e => calls.push(e))
  return { pc, calls, sent, negotiation }
}

test("initiator performs complete ICE restart SDP negotiation once, without overlapping offers", async () => {
  const { negotiation: n, calls, sent } = fixture(true)
  await n.start()
  await Promise.all([n.recover(), n.recover()])
  assert.equal(calls.filter(x => x === "restart-offer").length, 0, "wait for initial answer")
  await n.receive({ kind: "answer", sdp: "answer-1" })
  assert.equal(calls.filter(x => x === "restart-offer").length, 1)
  assert.equal(sent.filter(x => x.kind === "offer").length, 2)
  assert.equal(calls.filter(x => x === "local-offer").length, 2)
  await n.receive({ kind: "answer", sdp: "answer-2" })
  n.failed()
  await n.recover()
  assert.equal(sent.length, 2, "failure must not cause restart loop")
  n.recovered()
  await n.recover()
  assert.equal(sent.length, 3, "new recovered call can later recover another outage")
})

test("receiver requests restart and answers offers; duplicate offers and glare are ignored", async () => {
  const { negotiation: n, sent, calls } = fixture(false)
  await n.receive({ kind: "offer", sdp: "initial" })

  // Tested right here, before any second/distinct offer arrives — a
  // genuinely different later offer auto-detects as its own implicit ICE
  // restart (see the "offer" branch's own `lastOffer && !recoveryPending`
  // check) and would otherwise spend recover()'s one-shot budget first.
  await n.recover()
  assert.deepEqual(sent[sent.length - 1], { kind: "ice-restart-request" })

  // A duplicate of the exact same offer is ignored — no second answer.
  await n.receive({ kind: "offer", sdp: "initial" })
  assert.equal(sent.filter(s => s.kind === "answer").length, 1)

  // A genuinely new offer (the restart itself) is answered again.
  await n.receive({ kind: "offer", sdp: "restart" })
  assert.equal(sent.filter(s => s.kind === "answer").length, 2)
  assert.equal(calls.filter(c => c === "local-answer").length, 2)
  assert.equal(sent.filter(s => s.kind === "offer").length, 0)

  const offerer = fixture(true)
  await offerer.negotiation.receive({ kind: "offer", sdp: "glare" })
  assert.equal(offerer.sent.length, 0)
})

test("a non-initiator's recover() sends ice-restart-request — the initiator is the only side that ever creates offers", async () => {
  const { negotiation: n, sent } = fixture(false)
  await n.recover()
  assert.deepEqual(sent, [{ kind: "ice-restart-request" }])
  // One-shot — a second recover() before recovered()/failed() sends nothing more.
  await n.recover()
  assert.equal(sent.length, 1)
})

test("a matching-ufrag candidate is buffered until its SDP applies", async () => {
  const { negotiation: n, calls } = fixture(false)
  await n.receive({ kind: "ice", candidate: { usernameFragment: "one" } })
  assert.equal(calls.includes("candidate"), false, "no remote description yet — buffered, not applied")

  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:one\r\n" })
  assert.equal(calls.filter(c => c === "candidate").length, 1, "the buffered candidate is flushed once the matching offer applies")

  await n.receive({ kind: "ice", candidate: { usernameFragment: "one" } })
  assert.equal(calls.filter(c => c === "candidate").length, 2)
})

test("disposed room cannot send an offer after an awaited operation finishes", async () => {
  const { negotiation: n, pc, sent } = fixture(true)
  let release!: () => void
  pc.createOffer = async () => { await new Promise<void>(r => { release = r }); return { type: "offer", sdp: "old" } }
  const starting = n.start()
  await Promise.resolve()
  n.dispose()
  release()
  await starting
  assert.equal(sent.length, 0)
})

// --- recoveryAvailable() — hooks/useWebRTC.ts's own recovery state machine
// reads this (see lib/webrtcRecovery.ts's decideConnectionRecoveryAction)
// to decide whether a fresh disconnected/failed report is a genuinely new
// problem worth its own attempt, or the SAME still-unresolved one that
// must never be retried a second time.

test("recoveryAvailable() starts true, goes false the instant a restart is used, and comes back true only once recovered() confirms success", async () => {
  const { negotiation: n } = fixture(true)
  await n.start()
  assert.equal(n.recoveryAvailable(), true, "nothing has gone wrong yet")

  await n.recover()
  assert.equal(n.recoveryAvailable(), false, "the one restart for this problem is now in flight")

  await n.receive({ kind: "answer", sdp: "restart-answer" })
  assert.equal(n.recoveryAvailable(), false, "still not available — recover() only clears via recovered(), not merely a new answer")

  n.recovered()
  assert.equal(n.recoveryAvailable(), true, "a genuinely later problem gets its own fresh attempt")
})

test("recoveryAvailable() stays false after failed() — a restart that didn't resolve is never retried for the same problem", async () => {
  const { negotiation: n } = fixture(true)
  await n.start()
  await n.recover()
  n.failed()
  assert.equal(n.recoveryAvailable(), false)
  await n.recover()
  assert.equal(n.recoveryAvailable(), false, "recover() itself is a no-op once used — see the ICE-restart-loop test above")
})

test("recoveryAvailable() is false once disposed", () => {
  const { negotiation: n } = fixture(true)
  n.dispose()
  assert.equal(n.recoveryAvailable(), false)
})
