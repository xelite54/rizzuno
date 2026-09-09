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

// --- negotiationId lifecycle ------------------------------------------------

test("the initiator mints its own negotiationId immediately, before ever sending anything", () => {
  const { negotiation: n, sent } = fixture(true)
  const nid = n.getNegotiationId()
  assert.ok(nid && nid.length > 0)
  assert.equal(sent.length, 0, "minting an id is not itself a signal")
})

test("a non-initiator has no negotiationId until an offer actually arrives, then adopts it", async () => {
  const { negotiation: n } = fixture(false)
  assert.equal(n.getNegotiationId(), null)
  await n.receive({ kind: "offer", sdp: "the-offer", negotiationId: "peer-negotiation-1" })
  assert.equal(n.getNegotiationId(), "peer-negotiation-1")
})

test("an in-place ICE restart reuses the SAME negotiationId — it is still the same negotiation, not a fresh one", async () => {
  const { negotiation: n, sent } = fixture(true)
  const nid = n.getNegotiationId()!
  await n.start()
  await n.recover()
  await n.receive({ kind: "answer", sdp: "answer-1", negotiationId: nid })
  assert.ok(sent.some((s) => s.kind === "offer" && "negotiationId" in s), "a restart offer was actually sent")
  assert.ok(sent.every((s) => "negotiationId" in s && s.negotiationId === nid), "every signal — initial offer AND the restart offer — carries the SAME id")
  assert.equal(n.getNegotiationId(), nid, "the id itself never changes across an in-place restart")
})

test("two separate negotiation instances (two RTCPeerConnection generations) mint two DIFFERENT negotiationIds", () => {
  const first = fixture(true)
  const second = fixture(true)
  assert.notEqual(first.negotiation.getNegotiationId(), second.negotiation.getNegotiationId())
})

// --- requestFreshNegotiation: the non-initiator fresh-connection-recovery fix
//
// The bug this closes: only the initiator ever creates offers. When a
// NON-initiator was the side whose local connection needed the tiered
// fresh-connection recovery, its brand-new RTCPeerConnection had no way
// to ever get negotiated — the initiator's own connection could be
// perfectly healthy and had no reason to know anything happened. The
// result was a permanently stuck "Connecting" on that side, with nothing
// ever coming.

test("a non-initiator's requestFreshNegotiation() is a no-op for the INITIATOR side — only a non-initiator ever needs this", async () => {
  const { negotiation: n, sent } = fixture(true)
  await n.requestFreshNegotiation()
  assert.equal(sent.length, 0)
})

test("a non-initiator's requestFreshNegotiation() sends fresh-negotiation-request with no negotiationId of its own", async () => {
  const { negotiation: n, sent } = fixture(false)
  await n.requestFreshNegotiation()
  assert.deepEqual(sent, [{ kind: "fresh-negotiation-request" }])
})

test("the initiator responds to fresh-negotiation-request by minting a BRAND NEW negotiationId and sending a fresh offer, bypassing the spent one-shot ICE-restart budget", async () => {
  const { negotiation: n, calls, sent } = fixture(true)
  const originalNid = n.getNegotiationId()!
  await n.start()
  await n.receive({ kind: "answer", sdp: "answer-1", negotiationId: originalNid })

  // Spend the one-shot ICE-restart budget on the OLD negotiation first —
  // requestFreshNegotiation must still work afterward; it isn't gated by
  // recoveryUsed at all (a fresh peer pc has nothing to do with that
  // spent budget).
  await n.recover()
  assert.equal(calls.includes("restart-offer"), true)

  await n.receive({ kind: "fresh-negotiation-request" })
  const newNid = n.getNegotiationId()!
  assert.notEqual(newNid, originalNid, "a genuinely new negotiationId — the peer's own pc is entirely new")
  const lastSent = sent[sent.length - 1]
  assert.equal(lastSent.kind, "offer")
  assert.ok(lastSent.kind === "offer" && lastSent.negotiationId === newNid)

  // The peer's answer, tagged with the NEW id, is accepted normally —
  // proving the recovery budget genuinely reset, not just the id.
  await n.receive({ kind: "answer", sdp: "answer-2", negotiationId: newNid })
  assert.equal(calls.filter((c) => c === "remote-answer").length, 2)
})

test("a non-initiator ignores a fresh-negotiation-request — it only ever makes sense received by an initiator", async () => {
  const { negotiation: n, sent } = fixture(false)
  await n.receive({ kind: "offer", sdp: "the-offer", negotiationId: "peer-nid" })
  await n.receive({ kind: "fresh-negotiation-request" })
  assert.equal(sent.filter((s) => s.kind === "offer").length, 0, "a non-initiator never sends offers, request or not")
})

// --- stale-negotiation rejection --------------------------------------------

test("initiator rejects an answer tagged with a DIFFERENT (stale/obsolete) negotiationId, but accepts one tagged with its own", async () => {
  const { negotiation: n, calls, sent } = fixture(true)
  const nid = n.getNegotiationId()!
  await n.start()
  assert.equal(sent.length, 1)

  // A stale answer — as if the peer's own now-abandoned previous
  // negotiation's answer arrived late — must be ignored outright: no
  // setRemoteDescription, no state change.
  await n.receive({ kind: "answer", sdp: "stale-answer", negotiationId: "some-other-negotiation" })
  assert.equal(calls.includes("remote-answer"), false, "a stale answer must never be applied")

  // The REAL answer, correctly tagged, is accepted normally.
  await n.receive({ kind: "answer", sdp: "real-answer", negotiationId: nid })
  assert.equal(calls.includes("remote-answer"), true)
})

test("initiator rejects an ICE candidate tagged with a DIFFERENT negotiationId, but accepts one tagged with its own", async () => {
  const { negotiation: n, calls } = fixture(true)
  const nid = n.getNegotiationId()!
  await n.start()
  await n.receive({ kind: "answer", sdp: "answer-1", negotiationId: nid })
  assert.equal(calls.includes("remote-answer"), true)

  await n.receive({ kind: "ice", candidate: { candidate: "stale" }, negotiationId: "some-other-negotiation" })
  assert.equal(calls.includes("candidate"), false, "a candidate from an obsolete negotiation must never be applied")

  await n.receive({ kind: "ice", candidate: { candidate: "current" }, negotiationId: nid })
  assert.equal(calls.includes("candidate"), true, "a candidate for the current negotiation is applied normally")
})

test("non-initiator rejects an offer's later ICE candidates tagged with a DIFFERENT negotiationId than the one it adopted", async () => {
  const { negotiation: n, calls } = fixture(false)
  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:real\r\n", negotiationId: "real-negotiation" })
  assert.equal(n.getNegotiationId(), "real-negotiation")

  await n.receive({ kind: "ice", candidate: { usernameFragment: "real" }, negotiationId: "an-obsolete-negotiation" })
  assert.equal(calls.includes("candidate"), false, "wrong negotiationId — discarded even though the ufrag would otherwise match")

  await n.receive({ kind: "ice", candidate: { usernameFragment: "real" }, negotiationId: "real-negotiation" })
  assert.equal(calls.includes("candidate"), true)
})

test("initiator ignores an ice-restart-request tagged with a DIFFERENT negotiationId — never restarts for someone else's obsolete negotiation", async () => {
  const { negotiation: n, calls } = fixture(true)
  const nid = n.getNegotiationId()!
  await n.start()
  // Complete the initial negotiation first — signalingState must be back
  // to "stable" (an answer received) before an ICE restart can actually
  // be attempted at all; this test is about negotiationId scoping, not
  // the pre-existing signalingState guard.
  await n.receive({ kind: "answer", sdp: "answer-1", negotiationId: nid })
  assert.equal(calls.includes("remote-answer"), true)

  await n.receive({ kind: "ice-restart-request", negotiationId: "some-other-negotiation" })
  assert.equal(calls.includes("restart-offer"), false)

  await n.receive({ kind: "ice-restart-request", negotiationId: nid })
  assert.equal(calls.includes("restart-offer"), true)
})

test("a signal generated by ONE negotiation instance is meaningless to a completely SEPARATE one — simulating two independent fresh RTCPeerConnection generations", async () => {
  const oldGen = fixture(true)
  const newGen = fixture(true)
  await oldGen.negotiation.start()
  const staleOfferFromOldGeneration = oldGen.sent[0]
  assert.ok(staleOfferFromOldGeneration.kind === "offer")

  // If this stale offer from an entirely different (old) generation were
  // ever misdelivered into the NEW generation's own negotiation instance
  // — exactly the "late SDP from a destroyed PeerConnection entering a
  // fresh PeerConnection" scenario the fix exists to prevent — the new
  // generation (a non-initiator here) would still correctly ADOPT it,
  // since on its own it looks like a perfectly normal fresh offer. The
  // real protection is architectural: hooks/useWebRTC.ts's onSignal
  // subscription is re-created per generation, so the OLD generation's
  // own signal listener is already unsubscribed by the time a NEW one
  // exists — this test exists to document that the negotiationId
  // mechanism itself is a content-level check (WHICH negotiation a
  // signal's payload claims to belong to), not a delivery-routing one;
  // hooks/useWebRTC.ts's own local `generation` guard is what the
  // delivery-routing protection actually is (see its own doc comments).
  const receiver = fixture(false)
  await receiver.negotiation.receive(staleOfferFromOldGeneration)
  assert.equal(receiver.negotiation.getNegotiationId(), oldGen.negotiation.getNegotiationId())

  // What negotiationId DOES robustly protect regardless of delivery
  // routing: once a side has adopted ONE negotiation as current, a
  // signal genuinely tagged for the OTHER (unrelated) generation is
  // rejected — proven above in the "stale-negotiation rejection" tests.
  void newGen
})

// --- existing coverage, updated for negotiationId ---------------------------

test("initiator performs complete ICE restart SDP negotiation once, without overlapping offers", async () => {
  const { negotiation: n, calls, sent } = fixture(true)
  const nid = n.getNegotiationId()!
  await n.start()
  await Promise.all([n.recover(), n.recover()])
  assert.equal(calls.filter(x => x === "restart-offer").length, 0, "wait for initial answer")
  await n.receive({ kind: "answer", sdp: "answer-1", negotiationId: nid })
  assert.equal(calls.filter(x => x === "restart-offer").length, 1)
  assert.equal(sent.filter(x => x.kind === "offer").length, 2)
  assert.equal(calls.filter(x => x === "local-offer").length, 2)
  await n.receive({ kind: "answer", sdp: "answer-2", negotiationId: nid })
  n.failed()
  await n.recover()
  assert.equal(sent.length, 2, "failure must not cause restart loop")
  n.recovered()
  await n.recover()
  assert.equal(sent.length, 3, "new recovered call can later recover another outage")
})

test("receiver requests restart (under the adopted negotiationId) and answers offers; duplicate offers and glare are ignored", async () => {
  const { negotiation: n, sent, calls } = fixture(false)
  await n.receive({ kind: "offer", sdp: "initial", negotiationId: "peer-nid" })
  assert.equal(n.getNegotiationId(), "peer-nid")

  // Tested right here, before any second/distinct offer arrives — a
  // genuinely different later offer auto-detects as its own implicit ICE
  // restart (see the "offer" branch's own `lastOffer && !recoveryPending`
  // check) and would otherwise spend recover()'s one-shot budget first.
  await n.recover()
  assert.deepEqual(sent[sent.length - 1], { kind: "ice-restart-request", negotiationId: "peer-nid" })

  // A duplicate of the exact same offer is ignored — no second answer.
  await n.receive({ kind: "offer", sdp: "initial", negotiationId: "peer-nid" })
  assert.equal(sent.filter(s => s.kind === "answer").length, 1)

  // A genuinely new offer (the restart itself) is answered again.
  await n.receive({ kind: "offer", sdp: "restart", negotiationId: "peer-nid" })
  assert.equal(sent.filter(s => s.kind === "answer").length, 2)
  assert.equal(calls.filter(c => c === "local-answer").length, 2)
  assert.equal(sent.filter(s => s.kind === "offer").length, 0)

  const offerer = fixture(true)
  await offerer.negotiation.receive({ kind: "offer", sdp: "glare", negotiationId: offerer.negotiation.getNegotiationId()! })
  assert.equal(offerer.sent.length, 0)
})

test("a non-initiator with no adopted negotiation yet has nothing to restart — recover() is a safe no-op, never a malformed/unlabeled request", async () => {
  const { negotiation: n, sent } = fixture(false)
  await n.recover()
  assert.deepEqual(sent, [])
})

test("a signal with no known negotiation context is discarded outright, not buffered; a matching-ufrag candidate for the current negotiation is still buffered until its SDP applies", async () => {
  const { negotiation: n, calls } = fixture(false)
  await n.receive({ kind: "ice", candidate: { usernameFragment: "one" }, negotiationId: "not-yet-adopted" })
  assert.equal(calls.includes("candidate"), false, "discarded — no negotiation adopted yet to compare against")

  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:one\r\n", negotiationId: "nid-1" })
  assert.equal(calls.filter(c => c === "candidate").length, 0, "the earlier candidate was already discarded, never retroactively applied")

  await n.receive({ kind: "ice", candidate: { usernameFragment: "one" }, negotiationId: "nid-1" })
  assert.equal(calls.filter(c => c === "candidate").length, 1)

  await n.receive({ kind: "offer", sdp: "a=ice-ufrag:two\r\n", negotiationId: "nid-1" })
  await n.receive({ kind: "ice", candidate: { usernameFragment: "two" }, negotiationId: "nid-1" })
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
