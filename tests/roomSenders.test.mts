import { test } from "node:test"
import assert from "node:assert/strict"
import { createRoomSenders } from "../lib/roomSenders"

// Browser SDP association is exercised by test:webrtc:browser. These doubles
// isolate attachment completion, missing capture, and replacement rejection.
// Node has no MediaStream; install only the stream grouping placeholder.
Object.defineProperty(globalThis, "MediaStream", { value: class {}, configurable: true })
function track(kind: "video" | "audio", readyState = "live") {
  return { kind, readyState, enabled: true } as MediaStreamTrack
}
function setup() {
  const senders: { track: MediaStreamTrack | null; replaceTrack: (value: MediaStreamTrack | null) => Promise<void> }[] = []
  const pc = { addTrack(value: MediaStreamTrack) {
    const sender = { track: value as MediaStreamTrack | null, async replaceTrack(next: MediaStreamTrack | null) { this.track = next } }
    senders.push(sender)
    return sender
  } }
  return { senders, room: createRoomSenders(pc as unknown as RTCPeerConnection) }
}
test("room readiness waits for live camera and reusable audio transceiver", async () => {
  const { room, senders } = setup()
  assert.equal(await room.sync(null, null, true), false)
  const video = track("video"), audio = track("audio")
  assert.equal(await room.sync(video, audio, true), true)
  assert.equal(room.video?.track, video)
  assert.equal(room.audio?.track, audio)
  assert.equal(senders.length, 2)
  assert.equal(await room.sync(track("video", "ended"), audio, true), false)
  assert.equal(room.video?.track, null)
})
test("muted-at-match creates reusable transceiver without transmitting microphone", async () => {
  const { room, senders } = setup()
  const video = track("video"), audio = track("audio")
  assert.equal(await room.sync(video, audio, false), true)
  assert.equal(audio.enabled, false)
  assert.equal(room.audio?.track, null)
  audio.enabled = true
  assert.equal(await room.sync(video, audio, true), true)
  assert.equal(room.audio?.track, audio)
  assert.equal(senders.length, 2)
})
test("switch completion is awaited and cannot create a second video sender", async () => {
  const { room, senders } = setup()
  const video = track("video"), audio = track("audio"), replacement = track("video")
  await room.sync(video, audio, true)
  let finish!: () => void
  senders[0].replaceTrack = next => new Promise<void>(resolve => { finish = () => { senders[0].track = next; resolve() } })
  let ready = false
  const pending = room.sync(replacement, audio, true).then(value => { ready = value })
  await Promise.resolve()
  assert.equal(ready, false)
  assert.equal(room.video?.track, video)
  finish(); await pending
  assert.equal(ready, true)
  assert.equal(room.video?.track, replacement)
  assert.equal(senders.length, 2)
})
test("a rejected camera replacement is observable instead of advertising readiness", async () => {
  const { room, senders } = setup()
  const video = track("video"), audio = track("audio")
  await room.sync(video, audio, true)
  senders[0].replaceTrack = async () => { throw new DOMException("test", "InvalidModificationError") }
  await assert.rejects(room.sync(track("video"), audio, true), { name: "InvalidModificationError" })
  assert.equal(room.video?.track, video)
})
