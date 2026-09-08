import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

// Minimal hook lifecycle harness: run the real legal hook, preserving hook
// slots and dependency comparison across renders. No browser/network needed.
const react = createRequire(import.meta.url)("react")
let cursor = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous React hook slots in the lifecycle harness
const slots: any[] = []
let effects: (() => void)[] = []
const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((value, i) => !Object.is(value, a[i]))
mock.method(react, "useState", (initial: unknown) => {
  const index = cursor++
  if (!(index in slots)) slots[index] = initial
  return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value }]
})
mock.method(react, "useRef", (initial: unknown) => {
  const index = cursor++
  return slots[index] ??= { current: initial }
})
mock.method(react, "useEffect", (fn: () => (() => void) | void, deps: unknown[]) => {
  const index = cursor++
  if (changed(slots[index]?.deps, deps)) effects.push(() => {
    slots[index]?.cleanup?.()
    slots[index] = { deps, cleanup: fn() }
  })
})
mock.method(react, "useCallback", (fn: unknown, deps: unknown[]) => {
  const index = cursor++
  if (changed(slots[index]?.deps, deps)) slots[index] = { deps, fn }
  return slots[index].fn
})
const { useLegalAcceptance } = await import("../hooks/useLegalAcceptance.ts")

test("background session callback changes do not disable an accepted account", async () => {
  let requests = 0
  mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ accepted: true }) })
  function render(accountId = "same-account") {
    cursor = 0; effects = []
    // eslint-disable-next-line react-hooks/rules-of-hooks -- the harness supplies the hook dispatcher and commits effects
    const result = useLegalAcceptance(true, async () => {}, accountId)
    effects.forEach((effect) => effect())
    return result
  }
  render()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(render().status, "accepted")
  assert.equal(render().status, "accepted")
  assert.equal(requests, 1)
  render("different-account")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests, 2, "a real account change must still re-check legal acceptance")
})
