import { auth } from "@/auth"
import { getUserIdByUsername, getUserStatus, getPublicProfile, isBlockedEitherWay } from "@/lib/db"
import { normalizeUsername } from "@/lib/username"
import { isRateLimited } from "@/lib/apiRateLimit"

export async function GET(_request: Request, { params }: { params: Promise<{ username: string }> }) {
  const userId = (await auth())?.user?.id
  if (!userId) return Response.json({ error: "not_authenticated" }, { status: 401 })
  if (isRateLimited(`public-profile:${userId}`, 60, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 })
  const username = normalizeUsername((await params).username)
  if (!username) return Response.json({ error: "not_found" }, { status: 404 })
  try {
    const targetId = await getUserIdByUsername(username)
    if (!targetId) return Response.json({ error: "not_found" }, { status: 404 })
    const [viewer, target, blocked] = await Promise.all([getUserStatus(userId), getUserStatus(targetId), isBlockedEitherWay(userId, targetId)])
    const unavailable = [viewer, target].some((status) => status.banned || status.deleted || (status.suspendedUntil && status.suspendedUntil > Date.now()))
    if (unavailable || blocked) return Response.json({ error: "not_found" }, { status: 404 })
    return Response.json(await getPublicProfile(targetId), { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "profile_unavailable" }, { status: 503 }) }
}
