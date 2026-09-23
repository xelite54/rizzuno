import { Profiler, StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { SessionProvider, useSession, signOut } from "next-auth/react"
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { MatchStage } from "../../components/match/MatchStage"
import { installSyntheticCapture } from "./syntheticCapture"
const account = new URLSearchParams(location.search).get("account") ?? "runtime-a"
installSyntheticCapture(account.endsWith("a") ? "a" : "b")
const nativeFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  if (typeof input === "string" && (input.startsWith("/api/") || input.startsWith(location.origin + "/api/"))) {
    const url = new URL(input, location.origin); url.searchParams.set("account", account)
    return nativeFetch(url, init)
  }
  return nativeFetch(input, init)
}
let cameraAvailable = true
const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
  if (!cameraAvailable && constraints.video) throw new DOMException("fixture camera unavailable", "NotFoundError")
  return capture(constraints)
} })
const sockets: WebSocket[] = []
const received: { type: string; reason?: string; roomId?: string }[] = []
const sent: { type: string }[] = []
const NativeSocket = WebSocket
window.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols); sockets.push(this)
    this.addEventListener("message", event => received.push(JSON.parse(event.data)))
  }
  send(data: string) { sent.push(JSON.parse(data)); super.send(data) }
}
const router = { bfcacheId: "runtime-fixture", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} }
let refreshSession: () => Promise<unknown> = async () => {}
let sessionStatus = "loading"
function SessionBridge() {
  const { update, status } = useSession()
  useEffect(() => { refreshSession = update; sessionStatus = status }, [update, status])
  return null
}
const selectors = ['button[aria-label*="microphone"]', 'button[aria-label^="Chat opens"],button[aria-label^="Open chat"]', 'button[aria-label="My profile"]', 'button[aria-label^="Friends"]']
let originals: (Element | null)[] = []
let frames = 0
let commits = 0
let mounts = 0
let monitoring = false
const failures: string[] = []
let scenario = "runtime"
function inspect() {
  if (!monitoring) return
  frames++
  selectors.forEach((selector, index) => {
    const nodes = document.querySelectorAll(selector)
    const node = nodes[0]
    let issue = nodes.length !== 1 ? `count=${nodes.length}` : node !== originals[index] ? "remounted" : ""
    if (node) {
      const bounds = node.getBoundingClientRect()
      let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top), right = Math.min(innerWidth, bounds.right), bottom = Math.min(innerHeight, bounds.bottom)
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent)
        if (css.display === "none" || css.visibility === "hidden" || Number(css.opacity) === 0) issue ||= "hidden"
        if (parent !== node && /hidden|clip|scroll|auto/.test(css.overflow)) {
          const rect = parent.getBoundingClientRect()
          left = Math.max(left, rect.left); top = Math.max(top, rect.top); right = Math.min(right, rect.right); bottom = Math.min(bottom, rect.bottom)
        }
      }
      if (right - left < bounds.width - 1 || bottom - top < bounds.height - 1 || bounds.width === 0) issue ||= "clipped"
    }
    if (issue && failures.length < 50) failures.push(`${scenario}: ${index}: ${issue}`)
  })
}
new MutationObserver(records => {
  if (!monitoring) return
  for (const record of records) for (const removed of record.removedNodes) {
    if (originals.some(node => node && (node === removed || removed.contains(node)))) failures.push(`${scenario}: control removed from DOM`)
  }
  inspect()
}).observe(document.getElementById("root")!, { subtree: true, childList: true, attributes: true })
function tick() { inspect(); requestAnimationFrame(tick) }
requestAnimationFrame(tick)
Object.assign(window, { homepage: {
  start: () => { originals = selectors.map(selector => document.querySelector(selector)); monitoring = true; inspect() },
  stop: () => { monitoring = false },
  label: (value: string) => { scenario = value },
  snapshot: () => ({ frames, commits, mounts, failures, scenario, received, sent, sessionStatus, openSockets: sockets.filter(s => s.readyState === WebSocket.OPEN).length,
    disabled: selectors.map(selector => (document.querySelector(selector) as HTMLButtonElement)?.disabled),
    selfTrackLive: (document.querySelector<HTMLVideoElement>('video[data-video-role="self"]')?.srcObject as MediaStream | null)?.getVideoTracks().some(track => track.readyState === "live") ?? false,
    layout: document.querySelector("main")?.getAttribute("data-layout"),
    peerPlaying: [...document.querySelectorAll<HTMLVideoElement>('video[data-video-role="peer"]')].some(v => !v.paused && v.readyState >= 2),
  }),
  refreshSession: () => refreshSession(),
  signOut: () => signOut({ redirect: false }),
  reconnect: () => sockets.filter(s => s.readyState === WebSocket.OPEN).forEach(s => s.close()),
  camera: (available: boolean) => {
    cameraAvailable = available
    if (!available) {
      const video = document.querySelector<HTMLVideoElement>('video[data-video-role="self"]')
      const stream = video?.srcObject as MediaStream | null
      stream?.getVideoTracks().forEach(track => { track.stop(); track.dispatchEvent(new Event("ended")) })
    }
    document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"))
  },
  swipe: () => document.querySelector("main > div:last-child > div")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
} })
createRoot(document.getElementById("root")!).render(<StrictMode><AppRouterContext.Provider value={router}><SessionProvider><SessionBridge /><Profiler id="homepage" onRender={(_id, phase) => { commits++; if (phase === "mount") mounts++ }}><MatchStage /></Profiler></SessionProvider></AppRouterContext.Provider></StrictMode>)
