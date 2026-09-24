/* eslint-disable @typescript-eslint/no-explicit-any -- Chrome DevTools JSON boundary */
import { build, stop } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { createServer } from "node:http"
import { launchChrome } from "./chrome.mts"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-homepage-"))
const output = await build({ entryPoints: ["tests/browser/homepageHarness.tsx"], bundle: true, outdir: artifactDir, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "service-fixtures", setup(build) {
  build.onResolve({ filter: /^(next-auth\/react|@\/hooks\/(useMyProfile|useLocalMedia|useMatchmaking|useLegalAcceptance))$/ }, () => ({ path: path.resolve("tests/browser/homepageFixtures.ts") }))
} }] })
const styles = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })
const css = styles.css + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "")
const server = createServer((req, res) => {
  if (req.url === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(output.outputFiles.find(file => file.path.endsWith(".js"))!.contents) }
  else if (req.url === "/harness.css") { res.setHeader("Content-Type", "text/css"); res.end(css) }
  else if (req.url === "/blank") res.end("<html><body></body></html>")
  else { res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>') }
})
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function launch(side: "a" | "b") {
  const profile = path.join(artifactDir, `profile-${side}`)
  const { process, endpoint } = await launchChrome(chrome, profile)
  const socket = new WebSocket(endpoint, { handshakeTimeout: 15_000 })
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

const browser = await launch("a")
const results: Record<string, unknown> = {}
try {
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call("Page.navigate", { url: origin })
  for (let i = 0; i < 100 && !(await browser.snapshot())?.commits; i++) await delay(100)
  assert.deepEqual(browser.errors, [], "homepage startup errors")
  // Record references from the first auth-loading render; never replace them.
  await browser.evaluate("window.homepage.start()")
  const start = Date.now()
  const duration = Number(process.env.HOMEPAGE_HOLD_MS ?? 180_000)
  const scenarios: string[] = await browser.evaluate("window.homepage.scenarios")
  const coverage = new Set<string>()
  let cycle = 0
  do {
    const scenario = scenarios[cycle % scenarios.length]
    await browser.evaluate(`window.homepage.set(${JSON.stringify(scenario)})`)
    if (cycle % scenarios.length === 0) {
      const mobile = Math.floor(cycle / scenarios.length) % 2 === 1
      await browser.call("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1440, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile })
    }
    await delay(2000) // Test stimulus cadence, never product visibility logic.
    const snapshot = await browser.snapshot()
    results.last = snapshot
    coverage.add(scenario)
    assert.deepEqual(browser.errors, [], "browser console/runtime errors")
    assert.deepEqual(snapshot.failures, [], `persistent controls in ${scenario}`)
    assert.equal(snapshot.mounts, 1, "homepage remounted")
    if ((scenario === "initial-loading" && cycle === 0) || scenario === "signed-out") assert.equal(snapshot.disabled[2], true, "profile needs an authenticated account")
    cycle++
    if (cycle % scenarios.length === 0) console.log(`HOMEPAGE: ${Date.now() - start}ms, ${snapshot.frames} frame/DOM samples, all controls retain original DOM nodes`)
  } while (Date.now() - start < duration)
  results.elapsedMs = Date.now() - start
  results.coverage = [...coverage]
  results.consoleErrors = browser.errors
  results.status = "passed"
  await browser.evaluate("window.homepage.stop(); window.homepage.set('idle')")
  await delay(100)
  const screenshot = await browser.call("Page.captureScreenshot", { format: "png" })
  await writeFile(path.join(artifactDir, "homepage.png"), Buffer.from(screenshot.data, "base64"))
  console.log(`HOMEPAGE: passed; evidence ${artifactDir}`)
} finally {
  results.consoleErrors = browser.errors
  console.log(`HOMEPAGE: evidence ${artifactDir}`)
  await writeFile(path.join(artifactDir, "results.json"), JSON.stringify(results, null, 2))
  await browser.close()
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  stop()
}
