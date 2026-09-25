/* eslint-disable @typescript-eslint/no-explicit-any -- CDP protocol results are untyped JSON test boundaries. */
// Real Chromium + real React: opens the shared PostViewer from both
// other-user post grids and drives it with genuine mouse, keyboard and
// touch input — prev/next arrows, boundaries, ArrowLeft/ArrowRight, swipe,
// Escape, close button and click-outside.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import { launchChrome } from "./chrome.mts"

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-post-viewer-"))
const output = await build({ entryPoints: ["tests/browser/postViewerHarness.tsx"], bundle: true, outdir: artifactDir, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": "." }, define: { "process.env.NODE_ENV": '"development"' } })
const styles = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })
const js = output.outputFiles.find((file) => file.path.endsWith(".js"))!.contents
const css = styles.css + (output.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "")
const colors = ["#d33", "#3a3", "#33d", "#dd3", "#d3d"]
const posts = colors.map((color, index) => ({ id: `post-${index + 1}`, dataUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`)}` }))

const server = createServer((req, res) => {
  const url = new URL(req.url!, "http://localhost")
  if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "application/javascript"); res.end(js) }
  else if (url.pathname === "/harness.css") { res.setHeader("Content-Type", "text/css"); res.end(css) }
  else if (url.pathname === "/api/profile/public/publicuser") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ username: "publicuser", profilePhoto: null, bio: "", posts })) }
  else if (url.pathname === "/api/profile/photos") { res.setHeader("Content-Type", "application/json"); res.end('{"photos":{}}') }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>') }
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const profile = path.join(artifactDir, "profile")
const browser = await launchChrome(chrome, profile)
const socket = new WebSocket(browser.endpoint)
await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject) })
let seq = 0
const pending = new Map<number, (message: any) => void>()
const errors: string[] = []
socket.on("message", (data) => {
  const message = JSON.parse(data.toString())
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
})
let sessionId: string | undefined
function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15_000)
    pending.set(id, (message) => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
const evaluate = async (expression: string) => {
  const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}
const snapshot = () => evaluate("window.harness.snapshot()")
async function until(description: string, predicate: (s: any) => boolean) {
  const deadline = Date.now() + 5_000
  let last: any
  while (Date.now() < deadline) { last = await snapshot(); if (predicate(last)) return last; await delay(50) }
  throw new Error(`Timed out: ${description}; last ${JSON.stringify(last)}`)
}
async function click(selector: string) {
  const point = await evaluate(`window.harness.center(${JSON.stringify(selector)})`)
  assert.ok(point, `no element for ${selector}`)
  await clickAt(point.x, point.y)
}
async function clickAt(x: number, y: number) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}
async function key(name: "ArrowLeft" | "ArrowRight" | "Escape") {
  const code = { ArrowLeft: 37, ArrowRight: 39, Escape: 27 }[name]
  await call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code })
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code })
}
async function swipe(dx: number) {
  const s = await snapshot(); assert.ok(s.open)
  const p = await evaluate(`window.harness.center("dialog[open] img")`)
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] })
  for (let step = 1; step <= 5; step++) await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + (dx * step) / 5, y: p.y }] })
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
const photo = (n: number) => (s: any) => s.open && s.label?.startsWith(`Photo ${n} of 5`)

try {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" })
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).sessionId
  await call("Runtime.enable")
  for (const viewport of [{ name: "desktop", width: 1280, height: 800, mobile: false }, { name: "mobile", width: 390, height: 844, mobile: true }]) {
    await call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await call("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile, maxTouchPoints: 5 })
    await call("Page.navigate", { url: origin })
    await until("page loaded", () => true).catch(() => {})
    await evaluate(`new Promise(r => { const t = setInterval(() => { if (document.querySelectorAll("#public .grid > button").length === 5) { clearInterval(t); r(true) } }, 25) })`)

    for (const surface of ["#friend", "#public"]) {
      const where = `${viewport.name} ${surface}`
      // Open the middle post.
      await click(`${surface} .grid > button:nth-child(3)`)
      let s = await until(`${where}: middle post opens`, photo(3))
      assert.equal(s.prevHidden, false, `${where}: previous arrow visible mid-gallery`)
      assert.equal(s.nextHidden, false, `${where}: next arrow visible mid-gallery`)
      assert.ok(s.imageInViewport && s.imageCentered, `${where}: image centered and contained`)
      assert.equal(s.alt, `Photo 3 posted by ${surface === "#friend" ? "friendly" : "publicuser"}`)

      // Arrow buttons navigate in profile order and don't close.
      await click('dialog[open] button[aria-label="Next post"]'); await until(`${where}: next → 4`, photo(4))
      await click('dialog[open] button[aria-label="Previous post"]'); await until(`${where}: previous → 3`, photo(3))
      await click('dialog[open] button[aria-label="Previous post"]'); await until(`${where}: previous → 2`, photo(2))

      // Keyboard, including the first-post boundary.
      await key("ArrowRight"); await until(`${where}: ArrowRight → 3`, photo(3))
      await key("ArrowLeft"); await key("ArrowLeft"); await key("ArrowLeft")
      s = await until(`${where}: ArrowLeft stops at 1`, photo(1))
      assert.ok(s.prevHidden && !s.nextHidden, `${where}: first post hides only the previous arrow`)
      assert.ok(s.focusInDialog, `${where}: focus stays in the viewer at the boundary`)
      await key("ArrowLeft"); await delay(100)
      assert.ok(photo(1)(await snapshot()), `${where}: ArrowLeft at first post is a no-op`)

      // Last-post boundary.
      for (let i = 0; i < 5; i++) await key("ArrowRight")
      s = await until(`${where}: ArrowRight stops at 5`, photo(5))
      assert.ok(s.nextHidden && !s.prevHidden, `${where}: last post hides only the next arrow`)

      // Swipe (touch on mobile; mouse drags never swipe on desktop).
      if (viewport.mobile) {
        await swipe(160); await until(`${where}: swipe right → 4`, photo(4))
        await swipe(-160); await until(`${where}: swipe left → 5`, photo(5))
      }

      // Clicking the image itself doesn't close; Escape does.
      await click("dialog[open] img"); await delay(300)
      assert.ok((await snapshot()).open, `${where}: clicking the image keeps the viewer open`)
      await key("Escape"); await until(`${where}: Escape closes`, (x) => !x.open)

      // Click outside the image closes.
      await click(`${surface} .grid > button:nth-child(2)`); await until(`${where}: reopen at 2`, photo(2))
      const img = await evaluate(`(() => { const r = document.querySelector("dialog[open] img").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 12 } })()`)
      await clickAt(img.x, img.y); await until(`${where}: click outside closes`, (x) => !x.open)

      // The close button closes.
      await click(`${surface} .grid > button:nth-child(5)`); await until(`${where}: reopen at 5`, photo(5))
      await click('dialog[open] button[aria-label="Close photo"]'); await until(`${where}: close button closes`, (x) => !x.open)
      console.log(`✔ ${where}: middle post, arrows, keyboard, boundaries${viewport.mobile ? ", swipe" : ""}, Escape, click-outside, close`)
    }
  }
  assert.deepEqual(errors, [], "no page exceptions")
  console.log("post viewer browser test passed")
} finally {
  socket.close(); browser.process.kill(); server.close()
  await rm(artifactDir, { recursive: true, force: true }).catch(() => {})
}
