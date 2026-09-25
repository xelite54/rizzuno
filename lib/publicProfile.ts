import { primeCurrentPhoto } from "./currentPhotos"

/** Fields GET /api/profile/public/[username] returns (lib/db.ts PublicProfile). */
export type FetchedPublicProfile = { username: string | null; profilePhoto: string | null; bio: string; posts: { id: string; dataUrl: string }[] }

// Several parts of one profile view (the avatar and the posts) read the same
// profile at once, so they share one request per username while it's in flight.
const inFlight = new Map<string, Promise<FetchedPublicProfile>>()

export function fetchPublicProfile(username: string, fetcher: typeof fetch = fetch): Promise<FetchedPublicProfile> {
  const pending = inFlight.get(username)
  if (pending) return pending
  const request = fetcher(`/api/profile/public/${encodeURIComponent(username)}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "Profile unavailable." : "Couldn’t load posts.")
      const data = await response.json() as Partial<FetchedPublicProfile>
      const profilePhoto = typeof data.profilePhoto === "string" && data.profilePhoto ? data.profilePhoto : null
      primeCurrentPhoto(username, profilePhoto)
      return {
        username: typeof data.username === "string" ? data.username : null,
        profilePhoto,
        bio: typeof data.bio === "string" ? data.bio : "",
        posts: Array.isArray(data.posts) ? data.posts : [],
      }
    })
    .finally(() => inFlight.delete(username))
  inFlight.set(username, request)
  return request
}

/**
 * The photo to show for someone else. Once the server's current profile is
 * loaded it always wins — including a `null` meaning they removed their
 * photo — over any snapshot (realtime hello, search row, localStorage
 * history). The snapshot is only a placeholder until then, or if the fetch fails.
 */
export function resolveProfilePhoto(fresh: Pick<FetchedPublicProfile, "profilePhoto"> | null | undefined, snapshot?: string | null): string | null {
  if (fresh) return fresh.profilePhoto
  return snapshot || null
}

/**
 * What the realtime socket is told about this account's own photo. The
 * server never trusts it (it re-reads `users.profile_photo`); it's only a
 * "changed / removed" signal. A stored reference passes through; a raw
 * data URL (e.g. an old localStorage cache) becomes a short fingerprint so
 * a multi-megabyte image can never oversize a hello/profile-update frame.
 */
export function realtimePhotoSignal(photo: string | null | undefined): string | null {
  if (!photo) return null
  if (!photo.startsWith("data:") && photo.length <= 512) return photo
  let hash = 0x811c9dc5
  for (let i = 0; i < photo.length; i++) hash = Math.imul(hash ^ photo.charCodeAt(i), 0x01000193)
  return `local:${photo.length}:${(hash >>> 0).toString(36)}`
}
