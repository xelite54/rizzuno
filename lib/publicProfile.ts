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
      return {
        username: typeof data.username === "string" ? data.username : null,
        profilePhoto: typeof data.profilePhoto === "string" && data.profilePhoto ? data.profilePhoto : null,
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
