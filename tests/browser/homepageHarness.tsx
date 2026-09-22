import { Profiler, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MatchStage } from "../../components/match/MatchStage"
import { scenarios, setScenario, setMedia } from "./homepageFixtures"

const canvas = document.createElement("canvas")
canvas.width = 320; canvas.height = 240
canvas.getContext("2d")!.fillRect(0, 0, 320, 240)
const stream = canvas.captureStream(1)
const audio = new AudioContext()
const oscillator = audio.createOscillator()
const destination = audio.createMediaStreamDestination()
oscillator.connect(destination); oscillator.start()
stream.addTrack(destination.stream.getAudioTracks()[0])
setMedia(stream)

const selectors = ['button[aria-label*="microphone"]', 'button[aria-label^="Chat opens"],button[aria-label^="Open chat"]', 'button[aria-label="My profile"]', 'button[aria-label^="Friends"]']
let originals: (Element | null)[] = []
let frames = 0
let commits = 0
let mounts = 0
let monitoring = false
const failures: string[] = []
let scenario = "initial-loading"
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
  scenarios,
  set: (value: string) => { scenario = value; setScenario(value) },
  start: () => { originals = selectors.map(selector => document.querySelector(selector)); monitoring = true; inspect() },
  snapshot: () => ({ frames, commits, mounts, failures, scenario, disabled: selectors.map(selector => (document.querySelector(selector) as HTMLButtonElement)?.disabled) }),
  stop: () => { monitoring = false },
} })
createRoot(document.getElementById("root")!).render(<StrictMode><Profiler id="homepage" onRender={(_id, phase) => { commits++; if (phase === "mount") mounts++ }}><MatchStage /></Profiler></StrictMode>)
