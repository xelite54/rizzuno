/* eslint-disable @typescript-eslint/no-explicit-any -- Chrome DevTools JSON boundary */
// Real MatchStage + real hooks + real WebSocket server (DB mocked): opens
// another user's profile from EVERY surface — match invitation, friend
// list, incoming request, search result (stranger → Add friend →
// Requested), current match, and recent-match history — and asserts each
// one opens the SAME shared UserProfileSheet with the same content
// (fresh server photo, name, bio, posts) and the right relationship controls.
import "../helpers/dbMock.mts"
import { dbMockState } from "../helpers/dbMock.mts"
import { createRizzunoWebSocketServer } from "../../server/ws-server"
import { mintTicket } from "../../lib/realtimeTicket"
import { build, stop } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { createServer } from "node:http"
import { launchChrome } from "./chrome.mts"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { WebSocket } from "ws"

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const artifactDir = await mkdtemp(path.join(tmpdir(), "rizzuno-profile-surfaces-"))
process.env.REALTIME_TICKET_SECRET = "profile-surfaces-fixture-secret"
const output = await build({ entryPoints: ["tests/browser/homepageRuntime.tsx"], bundle: true, outdir: artifactDir, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_WS_URL": '""' } })
const styles = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })
const css = styles.css + (output.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "")

// Fixtures: runtimea is friends with "friendly" and with runtimeb (so b
// can invite a to a match); "requester" has a pending request to a; search
// finds "strangerx".
dbMockState.friendships.set("fs-friendly", ["runtimea", "friendly"])
dbMockState.friendships.set("fs-ab", ["runtimea", "runtimeb"])
dbMockState.areFriendsImpl = async (a: string, b: string) => [a, b].includes("runtimea") && [a, b].includes("runtimeb")
dbMockState.incomingRequests = [{ requestId: "req-1", senderId: "requester", username: "requester", profilePhoto: null, createdAt: 1 }]
const photoFor = (username: string) => `/api/media/${username}.webp`
const postSvg = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`)}`
// Realtime (mock DB) and HTTP agree on each user's stored photo, as the
// real database guarantees.
for (const name of ["runtimea", "runtimeb", "friendly", "requester"]) { dbMockState.usernames.set(name, name); dbMockState.photos.set(name, photoFor(name)) }
dbMockState.incomingRequests[0].profilePhoto = photoFor("requester")
const avatarSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#8a5"/></svg>'
const friendRequests: string[] = []

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost")
  const account = url.searchParams.get("account") ?? "runtimea"
  const json = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)) }
  if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(output.outputFiles.find((file) => file.path.endsWith(".js"))!.contents) }
  else if (url.pathname === "/harness.css") { res.setHeader("Content-Type", "text/css"); res.end(css) }
  else if (url.pathname === "/api/auth/csrf") json({ csrfToken: "fixture-csrf" })
  else if (url.pathname === "/api/auth/session") json({ user: { id: account, name: account }, expires: new Date(Date.now() + 3600_000).toISOString() })
  else if (url.pathname === "/api/legal/status") json({ accepted: true })
  else if (url.pathname === "/api/profile/me") {
    const gender = account.endsWith("a") ? "male" : "female"
    dbMockState.usernames.set(account, account); dbMockState.genders.set(account, gender)
    json({ username: account, gender, profilePhoto: null, bio: "", posts: [] })
  }
  else if (url.pathname === "/api/realtime/ticket") json({ ticket: mintTicket(account) })
  else if (url.pathname === "/api/realtime/turn") json({ configured: false })
  else if (url.pathname.startsWith("/api/profile/public/")) {
    const username = decodeURIComponent(url.pathname.split("/").pop()!)
    json({ username, profilePhoto: photoFor(username), bio: `Bio of ${username}`, posts: ["#d33", "#3a3", "#33d"].map((color, i) => ({ id: `${username}-post-${i}`, dataUrl: postSvg(color) })) })
  }
  else if (url.pathname === "/api/profile/photos") json({ photos: Object.fromEntries(url.searchParams.getAll("u").map((u) => [u, photoFor(u)])) })
  else if (url.pathname.startsWith("/api/media/")) { res.setHeader("Content-Type", "image/svg+xml"); res.end(avatarSvg) }
  else if (url.pathname === "/api/friends/search") json({ results: [{ username: "strangerx", profilePhoto: null, alreadyRequested: false, alreadyFriends: false }] })
  else if (url.pathname === "/api/friends/request") {
    let body = ""; for await (const chunk of req) body += chunk
    friendRequests.push(JSON.parse(body).username); json({ result: "sent" })
  }
  else if (url.pathname.startsWith("/api/friends/messages/")) json({ messages: [] })
  else if (url.pathname === "/blank") res.end("<html><body></body></html>")
  else if (url.pathname.startsWith("/api/")) json({ error: "fixture_unknown_endpoint" }, 404)
  else { res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>') }
})
const wss = createRizzunoWebSocketServer()
server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)))
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function launch(side: "a" | "b") {
  const profile = path.join(artifactDir, `profile-${side}`)
  const { process, endpoint } = await launchChrome(chrome, profile)
  const socket = new WebSocket(endpoint, { handshakeTimeout: 15_000 })
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject) })
  let seq = 0
  const pending = new Map<number, (message: any) => void>()
  const errors: string[] = []
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString())
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
    else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  })
  const session: { id?: string } = {}
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30_000)
    pending.set(id, (message) => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params, sessionId: session.id }))
  })
  await call("Browser.grantPermissions", { origin, permissions: ["audioCapture", "videoCapture"] })
  const { targetId } = await call("Target.createTarget", { url: `${origin}/blank` })
  session.id = (await call("Target.attachToTarget", { targetId, flatten: true })).sessionId
  await call("Runtime.enable")
  const evaluate = async (expression: string) => {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  return { side, errors, call, evaluate, close: async () => { socket.close(); process.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {}) } }
}

const [a, b] = [await launch("a"), await launch("b")]
async function until<T>(label: string, read: () => Promise<T>, ok: (value: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout
  let last: T | undefined
  while (Date.now() < deadline) { last = await read(); if (ok(last)) return last; await delay(100) }
  throw new Error(`Timeout: ${label}; last ${JSON.stringify(last)}`)
}
const clickSelector = (page: typeof a, selector: string) => page.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent !== null || getComputedStyle(e).position === "fixed"); if (!el) return false; el.click(); return true })()`)
const clickText = (page: typeof a, text: string) => page.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`)
async function click(page: typeof a, label: string, how: () => Promise<boolean>) { await until(`click ${label}`, how, Boolean) }

/** Structural fingerprint of whatever other-user profile is open. */
const sheet = () => a.evaluate(`(() => {
  const profiles = [...document.querySelectorAll('[role="dialog"]')].filter(d => (d.getAttribute("aria-label") || "").endsWith("'s profile"))
  const el = document.querySelector("[data-user-profile-sheet]")
  if (!el) return { open: false, profileDialogs: profiles.length }
  const photo = el.querySelector('button[aria-label$="profile photo"] img')
  return {
    open: true,
    profileDialogs: profiles.length,
    shared: profiles.length === 1 && profiles[0] === el,
    source: el.getAttribute("data-profile-source"),
    relationship: el.getAttribute("data-relationship"),
    name: el.querySelector("p.text-\\\\[18px\\\\]")?.textContent,
    bio: [...el.querySelectorAll("p")].map(p => p.textContent).find(t => t.startsWith("Bio of")) ?? null,
    photo: photo?.getAttribute("src") ?? null,
    posts: el.querySelectorAll(".grid > button").length,
    menu: !!el.querySelector('button[aria-label^="More options for"]'),
    buttons: [...el.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean),
  }
})()`)

type Expect = { source: string; name: string; relationship: string; buttons?: string[] }
const fingerprints: any[] = []
async function expectProfile(expected: Expect) {
  const s: any = await until(`${expected.source} profile loads`, sheet, (x: any) => x.open && x.posts === 3 && !!x.photo && x.source === expected.source)
  assert.equal(s.shared, true, `${expected.source}: the only profile dialog is the shared UserProfileSheet`)
  assert.equal(s.name, expected.name, `${expected.source}: name`)
  assert.equal(s.relationship, expected.relationship, `${expected.source}: relationship`)
  assert.equal(s.bio, `Bio of ${expected.name}`, `${expected.source}: bio from the fresh server profile`)
  assert.equal(s.photo, `/api/media/${expected.name}.webp`, `${expected.source}: current server photo`)
  assert.equal(s.menu, true, `${expected.source}: report/block menu`)
  for (const label of expected.buttons ?? []) assert.ok(s.buttons.includes(label), `${expected.source}: shows ${label} (${s.buttons})`)
  // The shared post viewer opens from this profile too.
  await clickSelector(a, "[data-user-profile-sheet] .grid > button:nth-child(2)")
  await until(`${expected.source} post viewer`, () => a.evaluate(`document.querySelector("dialog[open]")?.getAttribute("aria-label") ?? ""`), (label: string) => label.startsWith("Photo 2 of 3"))
  await a.evaluate(`document.querySelector('dialog[open] button[aria-label="Close photo"]').click()`)
  await until(`${expected.source} post viewer closed`, () => a.evaluate(`!document.querySelector("dialog[open]")`), Boolean)
  fingerprints.push({ ...s, buttons: undefined })
  console.log(`✔ ${expected.source}: shared UserProfileSheet — ${expected.name}, ${expected.relationship}, photo, bio, 3 posts, post viewer`)
}
async function closeProfile() {
  await clickSelector(a, '[data-user-profile-sheet] button[aria-label="Close"]')
  await until("profile closed", sheet, (x: any) => !x.open)
}

try {
  for (const page of [a, b]) {
    await page.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.call("Page.navigate", { url: `${origin}/?account=runtime${page.side}` })
  }
  const ready = (page: typeof a) => page.evaluate(`(() => { const s = window.homepage?.snapshot(); return !!s && s.received.some(m => m.type === "ready") && !s.disabled[3] })()`)
  await until("both accounts connected", async () => (await ready(a)) && (await ready(b)), Boolean, 30_000)
  await until("friends snapshot", () => a.evaluate(`window.homepage.snapshot().received.some(m => m.type === "friends-snapshot")`), Boolean)

  // 1. Match invitation toast.
  await b.evaluate(`window.homepage.sendRaw({ type: "match-invite", targetUserId: "runtimea" })`)
  await click(a, "invitation avatar", () => clickSelector(a, `button[aria-label="View runtimeb's profile"]`))
  await expectProfile({ source: "invitation", name: "runtimeb", relationship: "friend" })
  await closeProfile()
  await clickSelector(a, 'button[aria-label="Dismiss match invitation notification"]')

  // 2. Friend list row → View profile.
  await click(a, "Friends", () => clickSelector(a, 'button[aria-label^="Friends"]'))
  await click(a, "friend row menu", () => clickSelector(a, 'button[aria-label="More options for friendly"]'))
  await click(a, "View profile", () => clickText(a, "View profile"))
  await expectProfile({ source: "friend", name: "friendly", relationship: "friend" })
  await closeProfile()

  // 3. Incoming request.
  await click(a, "requests", () => clickSelector(a, 'button[aria-label$=" requests"]'))
  await click(a, "request row", () => clickSelector(a, `[aria-label="View requester's profile"]`))
  await expectProfile({ source: "request", name: "requester", relationship: "incoming", buttons: ["Accept", "Decline"] })
  await closeProfile()
  await click(a, "back to friends", () => clickSelector(a, 'button[aria-label="Back to friends"]'))

  // 4. Search result: stranger → Add friend → Requested, in the same sheet.
  await click(a, "search", () => clickSelector(a, 'button[aria-label="Search people"]'))
  await until("search input", () => a.evaluate(`(() => { const i = document.querySelector('input[type="search"], input[placeholder*="earch"]'); if (!i) return false; i.focus(); return true })()`), Boolean)
  await a.call("Input.insertText", { text: "stranger" })
  await click(a, "search result", () => clickSelector(a, `[aria-label="View strangerx's profile"]`))
  await expectProfile({ source: "search", name: "strangerx", relationship: "stranger", buttons: ["Add friend"] })
  await click(a, "Add friend", () => clickSelector(a, '[data-user-profile-sheet] button[aria-label="Add friend"]'))
  await until("search profile shows Requested", sheet, (x: any) => x.relationship === "requested" && x.buttons.includes("Requested"))
  assert.deepEqual(friendRequests, ["strangerx"])
  console.log("✔ search: Add friend → Requested in place")
  await closeProfile()
  await clickSelector(a, 'button[aria-label="Close friends"]')

  // 5. Current match.
  await a.evaluate("window.homepage.swipe()")
  await until("a queued", () => a.evaluate(`window.homepage.snapshot().received.some(m => m.type === "queued")`), Boolean)
  await b.evaluate("window.homepage.swipe()")
  await until("matched", () => a.evaluate(`window.homepage.snapshot().received.some(m => m.type === "matched")`), Boolean, 30_000)
  await click(a, "match badge", () => clickSelector(a, `button[aria-label="View runtimeb's profile"]`))
  await expectProfile({ source: "match", name: "runtimeb", relationship: "friend" })
  await closeProfile()

  // 6. Recent matches (history) after the match ends.
  await click(a, "Stop", () => a.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.includes("Stop")); if (!el) return false; el.click(); return true })()`))
  await until("call ended", () => a.evaluate(`window.homepage.snapshot().layout === "home"`), Boolean)
  await click(a, "My profile", () => clickSelector(a, 'button[aria-label="My profile"]'))
  await click(a, "Settings", () => clickSelector(a, 'button[aria-label="Settings"]'))
  await click(a, "History", () => a.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.startsWith("History")); if (!el) return false; el.click(); return true })()`))
  await click(a, "history row", () => clickSelector(a, `[role="button"][aria-label="View runtimeb's profile"]`))
  await expectProfile({ source: "history", name: "runtimeb", relationship: "friend" })
  await closeProfile()

  // Same component, same structure, every surface.
  const shape = (f: any) => JSON.stringify({ shared: f.shared, profileDialogs: f.profileDialogs, posts: f.posts, menu: f.menu, hasPhoto: !!f.photo, hasBio: !!f.bio })
  assert.equal(new Set(fingerprints.map(shape)).size, 1, `identical profile structure: ${fingerprints.map(shape).join(" | ")}`)
  assert.deepEqual(fingerprints.map((f) => f.source), ["invitation", "friend", "request", "search", "match", "history"])
  assert.deepEqual(a.errors, [], "no page exceptions")
  console.log("profile surfaces browser test passed")
} finally {
  await Promise.allSettled([a.close(), b.close()])
  for (const client of wss.clients) client.terminate()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  stop()
  await rm(artifactDir, { recursive: true, force: true }).catch(() => {})
}
