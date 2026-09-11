/* eslint-disable @typescript-eslint/no-explicit-any -- CDP protocol and browser snapshots are untyped JSON test boundaries. */
// Real Chromium + real React hooks + real WebSocket server. Only account/DB
// services and camera hardware are fixtures; this is NOT a Google login test.
import "../helpers/dbMock.mts"
import { dbMockState } from "../helpers/dbMock.mts"
import { createRizzunoWebSocketServer } from "../../server/ws-server"
import { mintTicket } from "../../lib/realtimeTicket"
import { build } from "esbuild"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"

process.env.REALTIME_TICKET_SECRET = "browser-test-only-secret"
dbMockState.areFriendsImpl = async () => true
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-media-"))
const output = await build({ entryPoints: ["tests/browser/mediaHarness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_WS_URL": '""', "process.env.NEXT_PUBLIC_TURN_URL": '""', "process.env.NEXT_PUBLIC_TURN_USERNAME": '""', "process.env.NEXT_PUBLIC_TURN_CREDENTIAL": '""' } })
const html = '<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>'
const server = createServer((req, res) => {
  const url = new URL(req.url!, "http://localhost")
  if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "application/javascript"); res.end(output.outputFiles[0].contents) }
  else if (url.pathname === "/api/realtime/ticket") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ticket: mintTicket(url.searchParams.get("account") ?? "browser-a") })) }
  else if (url.pathname === "/api/realtime/turn") { res.setHeader("Content-Type", "application/json"); res.end('{"configured":false}') }
  else if (url.pathname === "/blank") res.end("<!doctype html><html><body>WebRTC regression fixture</body></html>")
  else { res.setHeader("Content-Type", "text/html"); res.end(html) }
})
const wss = createRizzunoWebSocketServer()
server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)))
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
const address = server.address() as { port: number }
const origin = `http://127.0.0.1:${address.port}`
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const browsers: Awaited<ReturnType<typeof launch>>[] = []
const results: Record<string, unknown> = {}

async function launch(side: "a" | "b") {
  const profile = path.join(artifactDir, `profile-${side}`)
  const process = spawn(chrome, ["--headless=new", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { process.kill(); reject(new Error("Chrome launch timeout")) }, 15_000)
    process.once("error", reject)
    process.once("exit", code => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}`)) })
    let stderr = ""
    process.stderr.on("data", data => {
      stderr += data.toString()
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const socket = new WebSocket(endpoint)
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject) })
  let seq = 0
  const pending = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void }>()
  const errors: string[] = []
  socket.on("close", () => { for (const handler of pending.values()) handler.reject(new Error("test browser closed")); pending.clear() })
  socket.on("message", data => {
    const message = JSON.parse(data.toString())
    if (message.id) {
      const handler = pending.get(message.id); pending.delete(message.id)
      if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result)
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  })
  function call(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    return new Promise<Record<string, any>>((resolve, reject) => {
      const id = ++seq; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30_000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } }); socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
  await call("Browser.grantPermissions", { origin, permissions: ["audioCapture", "videoCapture"] })
  const { targetId } = await call("Target.createTarget", { url: `${origin}/blank` })
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true })
  await call("Runtime.enable", {}, sessionId)
  async function evaluate(expression: string) {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false }, sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  return { side, errors, evaluate, call: (method: string, params = {}) => call(method, params, sessionId), snapshot: () => evaluate("window.harness?.snapshot()"), close: async () => {
    if (socket.readyState === WebSocket.OPEN) await call("Browser.close").catch(() => {})
    socket.close(); process.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {})
  } }
}
async function until(description: string, predicate: (snapshots: any[]) => boolean, timeout = 25_000) {
  const deadline = Date.now() + timeout
  let snapshots: any[] = []
  while (Date.now() < deadline) {
    snapshots = await Promise.all(browsers.map(b => b.snapshot()))
    if (snapshots.every(Boolean) && predicate(snapshots)) return snapshots
    await delay(250)
  }
  await writeFile(path.join(artifactDir, "failure.json"), JSON.stringify(snapshots, null, 2))
  throw new Error(`Timed out: ${description}; evidence ${artifactDir}/failure.json`)
}
function healthy(snapshots: any[], count?: number) {
  return snapshots.every(s => s.state === "active" && s.self?.playing && s.peer?.playing && s.self.correctStream && s.peer.correctStream && s.senderMatchesLocal && s.receiverMatchesRemote && s.separateStreams && s.openPeers === 1 && (count === undefined || s.pcCount === count))
}
function assertColors(snapshots: any[]) {
  snapshots.forEach((s, i) => {
    const selfColor = i === 0 ? 0 : 2, peerColor = i === 0 ? 2 : 0
    assert.ok(s.self.rgb[selfColor] > 180 && s.self.rgb[peerColor] < 100, "self displays this device's camera")
    assert.ok(s.peer.rgb[peerColor] > 180 && s.peer.rgb[selfColor] < 100, "peer displays opposite device's camera")
    assert.equal(s.events.filter((e: any) => e.event === "webrtc: peer created" && e.details.roomId === s.roomId).length, 1)
    assert.equal(s.events.filter((e: any) => ["webrtc: offer sent", "webrtc: offer received"].includes(e.event) && e.details.roomId === s.roomId).length, 1)
    assert.equal(s.events.filter((e: any) => ["webrtc: answer sent", "webrtc: answer received"].includes(e.event) && e.details.roomId === s.roomId).length, 1)
    assert.equal(s.transceivers.length, 2)
    assert.ok(s.transceivers.every((t: any) => t.currentDirection === "sendrecv" && t.associated))
  })
}
try {
  browsers.push(await launch("a"), await launch("b"))
  // Reproduce the original failure using real browser SDP association.
  results.originalFailure = await browsers[0].evaluate(`(async () => {
    const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;canvas.getContext("2d").fillRect(0,0,320,240);
    const media = canvas.captureStream(15); const ctx=new AudioContext();media.addTrack(ctx.createMediaStreamDestination().stream.getAudioTracks()[0]);
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    for (const pc of [a,b]) for (const kind of ['video','audio']) await pc.addTransceiver(kind,{direction:'sendrecv'}).sender.replaceTrack(media.getTracks().find(t=>t.kind===kind));
    await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
    const result = {answererTransceivers:b.getTransceivers().length, cameraSenderAssociated:b.getTransceivers().find(t=>t.sender.track?.kind==='video').mid!==null, offererVideoDirection:a.getTransceivers()[0].currentDirection};
    a.close();b.close();media.getTracks().forEach(t=>t.stop());ctx.close();return result;
  })()`)
  assert.deepEqual(results.originalFailure, { answererTransceivers: 4, cameraSenderAssociated: false, offererVideoDirection: "sendonly" })
  console.log("BROWSER: reproduced original one-way sender association failure")
  for (const browser of browsers) await browser.call("Page.navigate", { url: `${origin}/?account=browser-${browser.side}` })
  await until("capture and realtime ready", s => s.every(x => x.ready && x.status === "granted"))
  await browsers[0].evaluate("window.harness.blockAudio(true)")
  await browsers[0].evaluate("window.harness.find()")
  await browsers[1].evaluate("window.harness.find()")
  let snapshots = await until("both directions active", s => healthy(s, 1))
  assertColors(snapshots)
  const room = snapshots[0].roomId
  assert.equal(snapshots[1].roomId, room)
  snapshots.forEach(s => {
    const audio = s.events.findIndex((e: any) => e.event === "webrtc: remote audio ontrack")
    const video = s.events.findIndex((e: any) => e.event === "webrtc: remote video ontrack")
    assert.ok(audio >= 0 && video > audio, "audio-first delivery must still render the later video track")
  })
  console.log("BROWSER: both cameras render in correct tiles; both SDP directions sendrecv; one peer per side")
  // StrictMode intentionally opens/closes an initial socket at app mount;
  // there must be NO additional socket once this room exists.
  const socketCounts = snapshots.map(s => s.socketCount)
  await Promise.all(browsers.map(b => b.evaluate("window.harness.hydrate(false)")))
  const started = Date.now()
  let samples = 0
  while (Date.now() - started < Number(process.env.MEDIA_HOLD_MS ?? 120_000)) {
    await delay(5000)
    snapshots = await Promise.all(browsers.map(b => b.snapshot()))
    assert.ok(healthy(snapshots, 1))
    assertColors(snapshots)
    snapshots.forEach((s, i) => { assert.equal(s.roomId, room); assert.equal(s.socketCount, socketCounts[i]); assert.equal(s.openSockets, 1) })
    samples++
    if (samples % 6 === 0) console.log(`BROWSER: healthy bidirectional call at ${samples * 5}s`)
  }
  results.twoMinuteCall = { elapsedMs: Date.now() - started, samples, snapshots }
  assert.equal(snapshots[0].peer.muted, true, "autoplay fallback must keep the peer picture running muted")
  await browsers[0].evaluate("window.harness.blockAudio(false)")
  await browsers[0].call("Runtime.evaluate", { expression: "document.querySelector('button').click()", userGesture: true })
  await until("gesture restores peer sound", s => healthy(s, 1) && !s[0].peer.muted)
  await Promise.all(browsers.map(b => b.evaluate("window.harness.hydrate(true)")))
  await browsers[0].evaluate("window.harness.mute()")
  await until("mute detaches sender and keeps video", s => healthy(s, 1) && !s[0].audioSenderAttached)
  await browsers[0].evaluate("window.harness.mute()")
  await until("unmute restores sender", s => healthy(s, 1) && s[0].audioSenderAttached)
  await Promise.all(browsers.map(b => b.evaluate("window.harness.switchCamera()")))
  snapshots = await until("camera replacement without new peer", s => healthy(s, 1)); assertColors(snapshots)
  await Promise.all(browsers.map(b => b.evaluate("window.harness.endCaptureAndResume()")))
  snapshots = await until("ended capture reacquired on foreground", s => healthy(s, 1)); assertColors(snapshots)
  results.mediaControls = { mute: true, unmute: true, cameraReplacement: true, captureResume: true }
  console.log("BROWSER: mute, unmute, camera replacement, foreground capture reacquisition passed")
  await browsers[0].evaluate("window.harness.skip()")
  await until("skip leaves the first room", s => s.every(x => !x.roomId))
  // Respect the real ten-minute recent-partner cooldown. A third synthetic
  // account supplies the next random partner; production matching is unchanged.
  await browsers[1].evaluate('window.harness.changeAccount("browser-b-next")')
  await until("next account ready", s => s.every(x => x.ready))
  await browsers[1].evaluate("window.harness.find()")
  snapshots = await until("next random room", s => healthy(s, 2) && s.every(x => x.roomId !== room), 40_000)
  assertColors(snapshots)
  results.nextRandomRoom = snapshots
  await Promise.all(browsers.map(b => b.evaluate("window.harness.pause()")))
  await until("left room", s => s.every(x => !x.roomId))
  await browsers[0].evaluate('window.harness.invite("browser-b-next")')
  await until("friend invite received", s => s[1].invitations.some((i: any) => i.direction === "incoming"))
  await browsers[1].evaluate("window.harness.accept()")
  snapshots = await until("friend call bidirectional", s => healthy(s, 3)); assertColors(snapshots)
  results.friendCall = snapshots
  console.log("BROWSER: skip, next random match, friend/direct call passed")
  // A transient disconnect gets five seconds without starting an offer.
  await browsers[0].evaluate('window.harness.interruptTransport("disconnected")')
  await delay(3500)
  snapshots = await Promise.all(browsers.map(b => b.snapshot()))
  assert.equal(snapshots[0].events.filter((e: any) => e.event === "webrtc: ICE restart started").length, 0)
  await browsers[0].evaluate('window.harness.interruptTransport(null)')
  await until("transport grace recovers without restart", s => healthy(s, 3))
  // A lasting interruption negotiates ONE restart on the original peer.
  await browsers[0].evaluate('window.harness.interruptTransport("disconnected")')
  await until("one same-peer ICE restart", s => s[0].events.filter((e: any) => e.event === "webrtc: ICE restart started").length === 1, 10_000)
  await browsers[0].evaluate('window.harness.interruptTransport(null)')
  await until("same peer recovers", s => healthy(s, 3))
  results.transportRecovery = { shortGrace: true, samePeerRestart: true, pcCount: 3 }
  // Live inbound decode must never activate a paused peer element.
  await browsers[0].evaluate("window.harness.blockVideo(true); document.querySelector('video[data-video-role=peer]').pause()")
  snapshots = await until("decoder alone cannot activate", s => s[0].state === "connecting" && s[0].incomingFrames > 0)
  results.playbackGate = { state: snapshots[0].state, incomingFrames: snapshots[0].incomingFrames }
  await until("blank video has bounded room termination", s => s.every(x => !x.roomId), 30_000)
  await browsers[0].evaluate("window.harness.signOut()")
  await until("sign out closes signaling", s => s[0].openSockets === 0)
  assert.ok(browsers.every(b => b.errors.length === 0), JSON.stringify(browsers.map(b => b.errors)))
  results.status = "passed"
  console.log("BROWSER: playback gate, bounded blank-video termination, sign-out passed")
} finally {
  await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2))
  await Promise.allSettled(browsers.map(b => b.close()))
  for (const client of wss.clients) client.terminate()
  await new Promise<void>(resolve => wss.close(() => resolve()))
  await new Promise<void>(resolve => server.close(() => resolve()))
  console.log(`BROWSER: evidence ${artifactDir}/results.json`)
}
