import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { addPost, getUserStatus, describeDbError } from "@/lib/db"
import { moderateImage } from "@/lib/imageModeration"

/**
 * Adds one post to the caller's own profile — server-persisted (migration
 * 0005's user_posts table), so a friend viewing this account's profile via
 * GET /api/friends/profile/[friendshipId] actually sees it, not just
 * whatever's sitting in the POSTER's own browser localStorage.
 *
 * Every image this account ever tries to post goes through
 * moderateImage() (lib/imageModeration) BEFORE addPost() is ever called —
 * addPost() itself has no way to run without a prior "allow", by
 * construction: there is no code path here that reaches it otherwise.
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

  let body: { dataUrl?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (typeof body.dataUrl !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }

    const moderation = await moderateImage({ userId, dataUrl: body.dataUrl, surface: "post" })
    if (moderation.decision !== "allow") {
      // Generic, user-safe response either way — never a category, a
      // score, or which provider was involved (see moderateImage's own
      // doc comment). `unavailable` is the one thing surfaced, and only
      // so the client can tell "not allowed" apart from "couldn't check,
      // try again" — see components/match/MyProfileSheet.tsx.
      return NextResponse.json(
        { error: moderation.unavailable ? "moderation_unavailable" : "moderation_blocked" },
        { status: moderation.unavailable ? 503 : 422 }
      )
    }

    const post = await addPost(userId, body.dataUrl)
    return NextResponse.json({ post })
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/posts: POST failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
