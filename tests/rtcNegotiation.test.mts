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
  await n.recover()
  assert.deepEqual(sent, [{ kind: "ice-restart-request" }])
  await Promise.all([n.receive({ kind: "offer", sdp: "initial" }), n.receive({ kind: "offer", sdp: "initial" })])
  await n.receive({ kind: "offer", sdp: "restart" })
  assert.equal(sent.filter(s => s.kind === "answer").length, 2)
  assert.equal(calls.filter(c => c === "local-answer").length, 2)
  assert.equal(sent.filter(s => s.kind === "offer").length, 0)
  const offerer = fixture(true)
  await offerer.negotiation.receive({ kind: "offer", sdp: "glare" })
  assert.equal(offerer.sent.length, 0)
})
test("early ICE is buffered and restart-generation ICE waits for its SDP", async () => {
  const { negotiation: n, calls } = fixture(false)
  await n.receive({ kind: "ice", candidate: { usernameFragment: "one" } })
  assert.equal(calls.includes("candidate"), false)
  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:one\r\n" })
  assert.equal(calls.filter(c => c === "candidate").length, 1)
  await n.receive({ kind: "ice", candidate: { usernameFragment: "two" } })
  assert.equal(calls.filter(c => c === "candidate").length, 1)
  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:two\r\n" })
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
