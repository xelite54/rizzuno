import { withHttpMetrics } from "@/lib/httpMetrics"
import { auth } from "@/auth"
import { getCurrentProfilePhotos, getUserStatus } from "@/lib/db"
import { normalizeUsername } from "@/lib/username"
import { isRateLimited } from "@/lib/apiRateLimit"

const MAX_PHOTO_LOOKUP = 50

/**
 * Current profile photos for up to 50 usernames in one request — what every
 * small avatar (friend rows, requests, search results, chat header, match
 * badge, invitations, recent matches) resolves against, so `users.profile_photo`
 * is the one source of truth rather than whatever snapshot a list carried.
 * `?u=alice&u=bob` → `{ photos: { alice: "/api/media/…" | null } }`. Accounts
 * the viewer may not see are omitted, exactly like the public profile route.
 */
async function handleGET(request: Request) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (await isRateLimited(`profile-photos:${userId}`, 120, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  const usernames = [...new Set(new URL(request.url).searchParams.getAll("u").map((u) => normalizeUsername(u)).filter((u): u is string => !!u))]
  if (usernames.length > MAX_PHOTO_LOOKUP) return Response.json({ error: "too_many" }, { status: 400 })
  try {
    const viewer = await getUserStatus(userId)
    if (viewer.banned || viewer.deleted || (viewer.suspendedUntil && viewer.suspendedUntil > Date.now())) return Response.json({ photos: {} }, { headers: { "Cache-Control": "no-store" } })
    return Response.json({ photos: await getCurrentProfilePhotos(userId, usernames) }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "profile_unavailable" }, { status: 503 }) }
}

export const GET = withHttpMetrics("/app/api/profile/photos", handleGET)
