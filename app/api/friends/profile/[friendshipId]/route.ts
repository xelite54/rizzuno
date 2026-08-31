import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getFriendshipOtherUser, getPublicProfile, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * A friend's real, server-stored profile — username/profilePhoto/bio/posts
 * only, never an id, email, or moderation/legal data (see PublicProfile's
 * own doc comment). This is the ONLY way a client ever sees anyone else's
 * profile content; friends-snapshot (server/ws-server.ts) deliberately
 * stays lightweight (id/userId/username/online/since) and never carries
 * photo/bio/posts itself.
 *
 * SECURITY: `friendshipId` is opaque and only ever came from this account's
 * own friends-snapshot — but that alone isn't enough to trust it, since a
 * client could in principle send ANY string. getFriendshipOtherUser() is
 * the one authoritative check: it looks up the friendship row and verifies
 * the AUTHENTICATED caller (never a client-supplied id) is actually a party
 * to it, returning the other side only if so — never confirming or denying
 * a friendship's existence to someone who isn't in it. There is no code
 * path here that resolves a client-supplied account id directly; the only
 * account id this ever touches is `session.user.id` (from the verified
 * session) and whatever getFriendshipOtherUser() itself resolves from that.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ friendshipId: string }> }) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("friends/profile: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`friends-profile:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const { friendshipId } = await params
  if (!friendshipId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const otherUserId = await getFriendshipOtherUser(userId, friendshipId)
    if (!otherUserId) {
      // Deliberately the same response whether the friendship never
      // existed or just isn't this account's — never confirms which.
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    const profile = await getPublicProfile(otherUserId)
    return NextResponse.json(profile)
  } catch (err) {
    const details = describeDbError(err)
    console.error("friends/profile: GET failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
