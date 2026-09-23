/* eslint-disable @typescript-eslint/no-explicit-any -- Chrome DevTools JSON boundary */
import "../helpers/dbMock.mts"
import { dbMockState } from "../helpers/dbMock.mts"
import { createRizzunoWebSocketServer } from "../../server/ws-server"
import { mintTicket } from "../../lib/realtimeTicket"
import { build, stop } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-runtime-"))
process.env.REALTIME_TICKET_SECRET = "runtime-fixture-secret"
const output = await build({ entryPoints: ["tests/browser/homepageRuntime.tsx"], bundle: true, outdir: artifactDir, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_WS_URL": '""' } })
const styles = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })
const css = styles.css + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "")
let ticketFailures = 0, invalidTickets = 0, staleHelloError = false
const tickets: string[] = []
const signedOut = new Set<string>()
const requests: Record<string, number> = {}
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost")
  const account = url.searchParams.get("account") ?? "runtime-a"
  requests[url.pathname] = (requests[url.pathname] ?? 0) + 1
  const json = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)) }
  if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(output.outputFiles.find(file => file.path.endsWith(".js"))!.contents) }
  else if (url.pathname === "/harness.css") { res.setHeader("Content-Type", "text/css"); res.end(css) }
  else if (url.pathname === "/api/auth/csrf") json({ csrfToken: "fixture-csrf" })
  else if (url.pathname === "/api/auth/signout") { signedOut.add(account); json({ url: "/" }) }
  else if (url.pathname === "/api/auth/session") json(signedOut.has(account) ? null : { user: { id: account, name: account }, expires: new Date(Date.now() + 3600_000).toISOString() })
  else if (url.pathname === "/api/legal/status") json({ accepted: !dbMockState.acceptanceRequiredUserIds.has(account) })
  else if (url.pathname === "/api/legal/accept") { dbMockState.acceptanceRequiredUserIds.delete(account); json({ ok: true }) }
  else if (url.pathname === "/api/profile/me") {
    await new Promise(resolve => setTimeout(resolve, 250))
    const gender = account.endsWith("a") ? "male" : "female"
    dbMockState.usernames.set(account, account); dbMockState.genders.set(account, gender)
    json({ username: account, gender, profilePhoto: null, bio: "", posts: [] })
  }
  else if (url.pathname === "/api/realtime/ticket") {
    tickets.push(account)
    if (ticketFailures > 0 && account === "runtime-a") { ticketFailures--; json({ error: "rate_limited" }, 429) }
    else if (invalidTickets > 0 && account === "runtime-a") { invalidTickets--; json({ ticket: "fixture-invalid" }) }
    else json({ ticket: mintTicket(account) })
  }
  else if (url.pathname === "/api/realtime/turn") json({ configured: false })
  else if (url.pathname === "/blank") res.end("<html><body></body></html>")
  else if (url.pathname.startsWith("/api/")) json({ error: "fixture_unknown_endpoint" }, 404)
  else { res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>') }
})
const wss = createRizzunoWebSocketServer()
wss.on("connection", ws => {
  const send = ws.send.bind(ws)
  ws.send = ((data: string, ...args: any[]) => {
    const message = JSON.parse(String(data))
    if (message.type === "ready" && staleHelloError) {
      staleHelloError = false
      send(JSON.stringify({ type: "error", context: "hello", message: "fixture transient hello error" }))
    }
    return send(data, ...args)
  }) as typeof ws.send
})
server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)))
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
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
    else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(JSON.stringify(message.params.args))
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
  return { side, errors, evaluate, call: (method: string, params = {}) => call(method, params, sessionId), snapshot: () => evaluate("window.homepage?.snapshot()"), close: async () => {
    if (socket.readyState === WebSocket.OPEN) await call("Browser.close").catch(() => {})
    socket.close(); process.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {})
  } }
}

const browsers = [await launch("a"), await launch("b")]
const results: Record<string, unknown> = {}
const coverage: string[] = []
async function check() {
  const snapshots = await Promise.all(browsers.map(b => b.snapshot()))
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.commits === 0) continue
    assert.deepEqual(snapshot.failures, [], "persistent controls")
    assert.equal(snapshot.mounts, 1)
  }
  for (const browser of browsers) assert.deepEqual(browser.errors.filter(e => !e.includes("fixture transient hello error") && !e.includes("invalid_ticket repeatedly")), [])
  return snapshots
}
async function until(label: string, predicate: (snapshots: any[]) => boolean, timeout = 25_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const snapshots = await check()
    if (snapshots.every(Boolean) && predicate(snapshots)) { coverage.push(label); console.log(`RUNTIME: ${label}`); return snapshots }
    await delay(100)
  }
  throw new Error(`Timeout: ${label}`)
}
try {
  for (const browser of browsers) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width: browser.side === "a" ? 1440 : 390, height: 900, deviceScaleFactor: 1, mobile: browser.side === "b" })
    await browser.call("Page.navigate", { url: `${origin}/?account=runtime-${browser.side}` })
  }
  await until("initial render", s => s.every(x => x.commits > 0))
  await Promise.all(browsers.map(b => b.evaluate("window.homepage.start()")))
  const started = Date.now()
  const readyCount = (s: any) => s.received.filter((m: any) => m.type === "ready").length
  await until("profile hydration, legal status and realtime connect", s => s.every(x => readyCount(x) === 1 && !x.disabled[2]))
  const beforeRefresh = tickets.length
  await browsers[0].evaluate("window.homepage.refreshSession()")
  await delay(2200); await check()
  assert.equal(tickets.length, beforeRefresh, "session refresh must not reconnect")
  coverage.push("session refresh")

  staleHelloError = true
  await browsers[0].evaluate("window.homepage.reconnect()")
  await until("reconnect and transient hello error", s => readyCount(s[0]) === 2)
  const afterReady = tickets.length
  await delay(2400); await check()
  assert.equal(tickets.length, afterReady, "stale 2s hello retry must be canceled after ready")
  coverage.push("stale hello timer canceled")

  ticketFailures = 1
  await browsers[0].evaluate("window.homepage.reconnect()")
  await until("rate-limited ticket retry", s => readyCount(s[0]) === 3)
  invalidTickets = 3
  await browsers[0].evaluate("window.homepage.reconnect()")
  await until("temporary restriction", s => s[0].received.filter((m: any) => m.reason === "invalid_ticket").length === 3 && s[0].disabled[3])
  await until("restriction recovered after server ready", s => readyCount(s[0]) === 4 && !s[0].disabled[3], 30_000)

  await browsers[0].evaluate("window.homepage.camera(false)")
  await until("camera unavailable", s => !s[0].selfTrackLive)
  assert.ok(await browsers[0].evaluate("document.body.textContent.includes('camera') || document.body.textContent.includes('Camera')"))
  await browsers[0].evaluate("window.homepage.camera(true)")
  await until("camera recovery", s => s[0].selfTrackLive)

  await until("camera focus session refresh settled", s => s[0].sessionStatus === "authenticated")
  await browsers[0].evaluate("window.homepage.signOut()")
  await until("signed out", s => s[0].disabled[2] && s[0].openSockets === 0)
  dbMockState.acceptanceRequiredUserIds.add("runtime-a")
  signedOut.delete("runtime-a")
  await browsers[0].evaluate("window.homepage.refreshSession()")
  await until("legal status refresh", s => s[0].openSockets === 0 && s[0].commits > 5)
  for (let i = 0; i < 100 && !(await browsers[0].evaluate("Boolean(document.querySelector('input[type=checkbox]'))")); i++) await delay(100)
  await browsers[0].evaluate("document.querySelector('input[type=checkbox]').click()")
  await browsers[0].evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Continue').click()")
  await until("legal acceptance recovery", s => readyCount(s[0]) === 5)

  await browsers[0].evaluate("window.homepage.swipe()")
  await until("searching", s => s[0].received.some((m: any) => m.type === "queued"))
  await browsers[1].evaluate("window.homepage.swipe()")
  await until("matched with real WebRTC", s => s.every(x => x.peerPlaying), 40_000)
  await browsers[0].evaluate("window.homepage.swipe()")
  await until("skipped", s => s[0].received.filter((m: any) => m.type === "queued").length >= 2)
  await browsers[0].evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Stop'))?.click()")
  await until("paused", s => s[0].layout === "home")
  while (Date.now() - started < Number(process.env.HOMEPAGE_HOLD_MS ?? 180_000)) {
    await delay(2000)
    await check()
  }
  results.status = "passed"; results.elapsedMs = Date.now() - started
  results.snapshots = await check(); results.coverage = coverage; results.requests = requests
  console.log(`RUNTIME: ${results.elapsedMs}ms passed, real hooks/HTTP/WebSocket/WebRTC; ${coverage.join(', ')}`)
} finally {
  results.errors = browsers.map(b => b.errors)
  results.snapshots ??= await Promise.all(browsers.map(b => b.snapshot().catch(() => null)))
  await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2))
  await Promise.allSettled(browsers.map(b => b.close()))
  for (const client of wss.clients) client.terminate()
  await new Promise<void>(resolve => wss.close(() => resolve()))
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  stop()
  console.log(`RUNTIME: evidence ${artifactDir}`)
}
