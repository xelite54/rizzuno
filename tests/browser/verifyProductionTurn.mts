// Explicitly authorized production relay probe. Shared secrets stay in Node;
// only a five-minute temporary credential reaches the configured TURN service.
/* eslint-disable @typescript-eslint/no-explicit-any -- Chromium CDP JSON boundary. */
import fs from "node:fs/promises"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { mintTurnCredential } from "../../lib/turnCredentials"

const auth = JSON.parse(await fs.readFile("/Users/sk/Library/Application Support/com.vercel.cli/auth.json", "utf8"))
async function api(path: string) {
  const url = new URL(path, "https://api.vercel.com")
  url.searchParams.set("teamId", "team_M9wfod9hfat8NtdUhR1iQgFH")
  const response = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!response.ok) throw new Error(`Vercel request failed: ${response.status}`)
  return response.json()
}
const project = await api("/v9/projects/rizzuno")
for (const key of ["NEXT_PUBLIC_TURN_URL", "TURN_STATIC_AUTH_SECRET"]) {
  const entry = project.env.find((item: any) => item.key === key && item.target.includes("production"))
  if (!entry) throw new Error(`Production ${key} is absent`)
  const variable = await api(`/v1/projects/${project.id}/env/${entry.id}`)
  if (typeof variable.value !== "string" || !variable.value) throw new Error(`Production ${key} is unavailable`)
  process.env[key] = variable.value
}
const temporary = mintTurnCredential(randomUUID(), 300)
if (!temporary) throw new Error("Temporary TURN credential could not be minted")
// Restrict the probe to destinations already observed in the public app bundle.
if (!temporary.urls.every(url => /^turns?:(?:global|relay1)\.expressturn\.com(?::\d+)?(?:\?transport=(?:udp|tcp))?$/.test(url))) {
  throw new Error("Configured TURN destination differs from the reviewed ExpressTURN hosts")
}
const { urls, username, credential } = temporary
const directory = await fs.mkdtemp("/private/tmp/rizzuno-turn-probe-")
const server = createServer((_request, response) => response.end("<!doctype html><title>TURN probe</title>"))
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
const child = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] })
let socket: WebSocket | undefined
try {
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome launch timeout")), 15_000)
    child.once("error", reject)
    child.stderr.on("data", data => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject) })
  let nextId = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  socket.on("message", data => {
    const message = JSON.parse(data.toString())
    if (!message.id) return
    const handler = pending.get(message.id); pending.delete(message.id)
    if (message.error) handler?.reject(new Error("Browser command failed"))
    else handler?.resolve(message.result)
  })
  function call(method: string, params = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error("Browser command timeout")) }, 35_000)
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
      socket!.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
  const { targetId } = await call("Target.createTarget", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true })
  // No interpolated values are written to logs or files.
  const expression = `(${async function probe(iceServer: RTCIceServer) {
    // Relay-only is confined to this isolated test; production remains "all".
    const config: RTCConfiguration = { iceServers: [iceServer], iceTransportPolicy: "relay" }
    const peers = [new RTCPeerConnection(config), new RTCPeerConnection(config)]
    const counts = [0, 0], errors: { side: number; code: number }[] = []
    const queues: RTCIceCandidate[][] = [[], []]
    let delivered = false
    peers.forEach((peer, index) => {
      peer.onicecandidateerror = event => errors.push({ side: index, code: event.errorCode })
      peer.onicecandidate = event => {
        if (!event.candidate) return
        if (event.candidate.type === "relay") counts[index]++
        const other = peers[1 - index]
        if (other.remoteDescription) void other.addIceCandidate(event.candidate).catch(() => {})
        else queues[1 - index].push(event.candidate)
      }
    })
    const [a, b] = peers
    const channel = a.createDataChannel("relay-test")
    b.ondatachannel = event => { event.channel.onmessage = message => event.channel.send(message.data) }
    channel.onopen = () => channel.send("relay-probe")
    channel.onmessage = event => { delivered = event.data === "relay-probe" }
    try {
      await a.setLocalDescription(await a.createOffer())
      await b.setRemoteDescription(a.localDescription!)
      for (const candidate of queues[1]) await b.addIceCandidate(candidate)
      await b.setLocalDescription(await b.createAnswer())
      await a.setRemoteDescription(b.localDescription!)
      for (const candidate of queues[0]) await a.addIceCandidate(candidate)
      const deadline = Date.now() + 20_000
      while (!delivered && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250))
      const selected = await Promise.all(peers.map(async peer => {
        const report = await peer.getStats()
        let pair: RTCStats | undefined
        report.forEach(stat => { if (stat.type === "transport" && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId) })
        const safePair = pair as { localCandidateId?: string; remoteCandidateId?: string } | undefined
        return safePair ? {
          localType: report.get(safePair.localCandidateId!)?.candidateType,
          remoteType: report.get(safePair.remoteCandidateId!)?.candidateType,
        } : null
      }))
      return { pingPong: delivered, states: peers.map(peer => peer.connectionState), relayCandidateCounts: counts, selected, errors }
    } finally { peers.forEach(peer => peer.close()) }
  }})(${JSON.stringify({ urls, username, credential })})`
  const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (response.exceptionDetails) throw new Error("TURN probe failed in browser")
  const result = response.result.value
  console.log(JSON.stringify(result))
  await fs.writeFile("/private/tmp/rizzuno-turn-results.json", JSON.stringify(result, null, 2))
  if (!result.pingPong) process.exitCode = 1
  await call("Browser.close")
} finally {
  socket?.close(); child.kill()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
}
