/* eslint-disable @typescript-eslint/no-explicit-any -- Chrome DevTools JSON boundary */
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-production-"))
const origin = process.env.PRODUCTION_URL
if (!origin || new URL(origin).protocol !== "https:") throw new Error("Set PRODUCTION_URL explicitly to the HTTPS site to verify")
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
import { transform } from "esbuild"
async function launch(side: "a" | "b") {
  const profile = path.join(artifactDir, `profile-${side}`)
  const process = spawn(chrome, ["--headless=new", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
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
  const { targetId } = await call("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true })
  await call("Runtime.enable", {}, sessionId)
  await call("Network.enable", {}, sessionId)
  const network: { path: string; status: number }[] = []
  socket.on("message", raw => {
    const event = JSON.parse(raw.toString())
    if (event.method === "Network.responseReceived") {
      const response = event.params.response
      const url = new URL(response.url)
      if (url.origin === origin) network.push({ path: url.pathname, status: response.status })
    }
  })
  async function evaluate(expression: string) {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false }, sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  return { side, errors, network, evaluate, call: (method: string, params = {}) => call(method, params, sessionId), snapshot: () => evaluate("window.homepage?.snapshot()"), close: async () => {
    if (socket.readyState === WebSocket.OPEN) await call("Browser.close").catch(() => {})
    socket.close(); process.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {})
  } }
}

const PROBE = "const selectors = ['button[aria-label*=\"microphone\"]', 'button[aria-label^=\"Chat opens\"],button[aria-label^=\"Open chat\"]', 'button[aria-label=\"My profile\"]', 'button[aria-label^=\"Friends\"]']\nlet originals: (Element | null)[] = []\nlet frames = 0\nlet commits = 0\nlet mounts = 0\nlet monitoring = false\nconst failures: string[] = []\nlet scenario = \"runtime\"\nfunction inspect() {\n  if (!monitoring) return\n  frames++\n  selectors.forEach((selector, index) => {\n    const nodes = document.querySelectorAll(selector)\n    const node = nodes[0]\n    let issue = nodes.length !== 1 ? `count=${nodes.length}` : node !== originals[index] ? \"remounted\" : \"\"\n    if (node) {\n      const bounds = node.getBoundingClientRect()\n      let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top), right = Math.min(innerWidth, bounds.right), bottom = Math.min(innerHeight, bounds.bottom)\n      for (let parent: Element | null = node; parent; parent = parent.parentElement) {\n        const css = getComputedStyle(parent)\n        if (css.display === \"none\" || css.visibility === \"hidden\" || Number(css.opacity) === 0) issue ||= \"hidden\"\n        if (parent !== node && /hidden|clip|scroll|auto/.test(css.overflow)) {\n          const rect = parent.getBoundingClientRect()\n          left = Math.max(left, rect.left); top = Math.max(top, rect.top); right = Math.min(right, rect.right); bottom = Math.min(bottom, rect.bottom)\n        }\n      }\n      if (right - left < bounds.width - 1 || bottom - top < bounds.height - 1 || bounds.width === 0) issue ||= \"clipped\"\n    }\n    if (issue && failures.length < 50) failures.push(`${scenario}: ${index}: ${issue}`)\n  })\n}\nnew MutationObserver(records => {\n  if (!monitoring) return\n  for (const record of records) for (const removed of record.removedNodes) {\n    if (originals.some(node => node && (node === removed || removed.contains(node)))) failures.push(`${scenario}: control removed from DOM`)\n  }\n  inspect()\n}).observe(document.body, { subtree: true, childList: true, attributes: true })\nfunction tick() { inspect(); requestAnimationFrame(tick) }\nrequestAnimationFrame(tick)\n\noriginals = selectors.map(selector => document.querySelector(selector)); monitoring = true; inspect();\nObject.assign(window, { homepage: { snapshot: () => ({ frames, failures, present: originals.map(node => node?.isConnected) }) } });\n"
const browser = await launch("a")
const results: Record<string, unknown> = {}
try {
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call("Page.navigate", { url: origin })
  for (let i = 0; i < 150; i++) {
    if (await browser.evaluate("Boolean(document.querySelector('[data-homepage-controls] button'))")) break
    await delay(100)
  }
  const probe = await transform(PROBE, { loader: "ts" })
  // The probe installs state on window; do not serialize the Window object over CDP.
  await browser.evaluate(`${probe.code}\nvoid 0`)
  const started = Date.now()
  while (Date.now() - started < Number(process.env.HOMEPAGE_HOLD_MS ?? 180_000)) {
    const mobile = Math.floor((Date.now() - started) / 30_000) % 2 === 1
    await browser.call("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1440, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile })
    await delay(2000)
    const snapshot = await browser.snapshot()
    results.snapshot = snapshot
    assert.deepEqual(snapshot.failures, [])
    assert.deepEqual(browser.errors, [])
  }
  results.elapsedMs = Date.now() - started
  results.status = "passed"
  const screenshot = await browser.call("Page.captureScreenshot", { format: "png" })
  await writeFile(path.join(artifactDir, "homepage.png"), Buffer.from(screenshot.data, "base64"))
  console.log(`PRODUCTION: ${results.elapsedMs}ms; controls retain original DOM identity and visibility`)
} finally {
  results.consoleErrors = browser.errors
  results.network = browser.network
  await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2))
  await browser.close()
  console.log(`PRODUCTION: evidence ${artifactDir}`)
}
