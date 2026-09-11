import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { listFriendMessages, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

/**
 * A friendship's real, persisted message history — the only way a client
 * ever loads past friend-chat messages (live ones arrive over the realtime
 * socket instead; see server/ws-server.ts's "friend-chat-message"). Chat
 * history is deliberately never carried in "friends-snapshot" (see that
 * message's own doc comment) — it stays lightweight, this is the one place
 * actual message content is ever returned.
 *
 * SECURITY: `friendshipId` is opaque and only ever came from this account's
 * own friends-snapshot — but that alone isn't enough to trust it, since a
 * client could in principle send ANY string. lib/db.ts's
 * listFriendMessages() is the one authoritative check: it verifies the
 * AUTHENTICATED caller (never a client-supplied id) is actually a party to
 * the friendship before returning anything, the same way
 * app/api/friends/profile/[friendshipId] already does for the same reason.
 * Never confirms or denies a friendship's existence to someone who isn't a
 * party to it — a friendship that doesn't exist and one that isn't this
 * account's own both come back identically as 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ friendshipId: string }> }) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("friends/messages: auth() threw — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`friends-messages:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const { friendshipId } = await params
  if (!friendshipId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const result = await listFriendMessages(userId, friendshipId, 50)
    if (result.status === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    // Diagnostic — count only, never message content or an account id.
    console.log("friends/messages: GET result", { messageCount: result.messages.length })
    return NextResponse.json({
      // `readAt` only actually means anything for a message this account
      // sent itself (a received message's own read state is never shown
      // back to the account that read it) — still included for every row
      // rather than nulled out server-side, the same way `mine` is derived
      // client-side rather than filtered here.
      messages: result.messages.map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, mine: m.senderId === userId, readAt: m.readAt })),
    })
  } catch (err) {
    const details = describeDbError(err)
    console.error("friends/messages: GET failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
