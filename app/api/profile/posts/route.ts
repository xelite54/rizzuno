import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { addPost, getUserStatus, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

// Same reasoning as app/api/profile/me/route.ts's own copy of these.
const MAX_PROFILE_IMAGE_LENGTH = 2_000_000
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i

/**
 * Adds one post to the caller's own profile — server-persisted (migration
 * 0005's user_posts table), so a friend viewing this account's profile via
 * GET /api/friends/profile/[friendshipId] actually sees it, not just
 * whatever's sitting in the POSTER's own browser localStorage.
 */
export async function POST(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("profile/posts: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`profile-post:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  let body: { dataUrl?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (
    typeof body.dataUrl !== "string" ||
    body.dataUrl.length > MAX_PROFILE_IMAGE_LENGTH ||
    !DATA_URL_IMAGE_PATTERN.test(body.dataUrl)
  ) {
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }
    const post = await addPost(userId, body.dataUrl)
    return NextResponse.json({ post })
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/posts: POST failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
