/**
 * Client-side store of other users' CURRENT profile photos, keyed by
 * username and filled from GET /api/profile/photos (i.e. `users.profile_photo`).
 * Every avatar reads through this, so once the server has answered, a
 * stale snapshot (localStorage history, an old search row, a realtime
 * payload from before a change) can no longer win anywhere.
 *
 * Lookups made in the same tick are batched into one request; entries
 * older than STALE_MS are re-fetched the next time an avatar mounts.
 */
export const STALE_MS = 60_000
const BATCH_LIMIT = 50

type Entry = { photo: string | null; at: number }
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let queued = new Set<string>()
let flushScheduled = false
const inFlight = new Set<string>()
let version = 0

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
let fetcher: Fetcher = (url, init) => fetch(url, init)
let clock = () => Date.now()

function emit() {
  version++
  for (const listener of listeners) listener()
}

export function subscribeCurrentPhotos(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const currentPhotosVersion = () => version

const key = (username: string) => username.trim().toLowerCase()

/** The server's photo for `username` if known (`null` = none / not visible), otherwise `undefined`. */
export function knownPhoto(username: string | null | undefined): string | null | undefined {
  if (!username) return undefined
  const entry = entries.get(key(username))
  return entry ? entry.photo : undefined
}

/** Record fresh server data obtained elsewhere (e.g. a full public profile load). */
export function primeCurrentPhoto(username: string | null | undefined, photo: string | null) {
  if (!username) return
  const k = key(username)
  const previous = entries.get(k)
  entries.set(k, { photo: photo || null, at: clock() })
  if (!previous || previous.photo !== (photo || null)) emit()
}

/** Ask for `username`'s current photo unless a fresh answer is already cached or pending. */
export function requestCurrentPhoto(username: string | null | undefined) {
  if (!username) return
  const k = key(username)
  const entry = entries.get(k)
  if ((entry && clock() - entry.at < STALE_MS) || inFlight.has(k)) return
  queued.add(k)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => { void flush() })
}

async function flush() {
  flushScheduled = false
  const batch = [...queued]
  queued = new Set()
  for (let i = 0; i < batch.length; i += BATCH_LIMIT) {
    const chunk = batch.slice(i, i + BATCH_LIMIT)
    chunk.forEach((k) => inFlight.add(k))
    try {
      const params = new URLSearchParams()
      chunk.forEach((k) => params.append("u", k))
      const response = await fetcher(`/api/profile/photos?${params}`, { cache: "no-store" })
      if (!response.ok) continue
      const { photos } = await response.json() as { photos?: Record<string, string | null> }
      const at = clock()
      let changed = false
      for (const k of chunk) {
        // Absent means "not visible to you" (blocked/banned/deleted/suspended): no photo.
        const photo = photos && typeof photos[k] === "string" && photos[k] ? photos[k] as string : null
        const previous = entries.get(k)
        entries.set(k, { photo, at })
        if (!previous || previous.photo !== photo) changed = true
      }
      if (changed) emit()
    } catch {
      // Network failure: keep showing whatever snapshot the caller has.
    } finally {
      chunk.forEach((k) => inFlight.delete(k))
    }
  }
}

/** Test hooks. */
export function __resetCurrentPhotos(options: { fetcher?: Fetcher; clock?: () => number } = {}) {
  entries.clear(); queued = new Set(); inFlight.clear(); flushScheduled = false
  fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  clock = options.clock ?? (() => Date.now())
}
export const __flushCurrentPhotos = flush
