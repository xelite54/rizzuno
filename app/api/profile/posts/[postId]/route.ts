import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { removePost, describeDbError } from "@/lib/db"

/** Deletes one of the caller's own posts — removePost() itself scopes the DELETE to `WHERE id = $1 AND user_id = $2`, so this can never remove a post belonging to someone else even if a client somehow guessed another account's post id. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("profile/posts/[postId]: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const ok = await removePost(userId, postId)
    return NextResponse.json({ ok })
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/posts/[postId]: DELETE failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
