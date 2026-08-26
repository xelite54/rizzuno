import { randomUUID } from "node:crypto"
import { WebSocketServer, WebSocket } from "ws"
import type { RawData } from "ws"
import { matchmaker } from "./matchmaker"
import { MAX_CHAT_IMAGE_LENGTH } from "../lib/signaling/protocol"
import type { ClientMessage, Gender, PublicPeerIdentity, ServerMessage } from "../lib/signaling/protocol"
import { verifyTicket } from "../lib/realtimeTicket"
import {
  getUserStatus,
  addBlock,
  fileReport,
  areFriends,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriendship,
  listFriends,
  listPendingRequestsReceived,
  listPendingRequestsSent,
  listBlockedByUserWithUsernames,
} from "../lib/db"
import { sanitizeText, containsSevereContent } from "../lib/textFilter"

const MAX_HANDLE_LENGTH = 40
const MAX_USERNAME_LENGTH = 24
const MAX_REPORT_DETAILS_LENGTH = 500
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i

type ConnectionState = {
  ws: WebSocket
  /** The Google account's own stable id — verified from the "hello" ticket, never taken from any other client-supplied field. */
  userId: string
  /** Random per-connection token, unrelated to `userId` — this, not the real account id, is what a matched peer actually sees (see PublicPeerIdentity in lib/signaling/protocol.ts). */
  displayId: string
  handle: string
  username?: string
  gender?: Gender
  profilePhoto?: string | null
  roomId: string | null
}

// userId -> live connection. A reconnect (e.g. after a network blip) simply
// overwrites its old entry; the old socket's own "close" handler cleans up
// its room membership.
const connections = new Map<string, ConnectionState>()

// The reverse of the map above, specifically for friend requests: sending
// one only ever names a displayId (see PublicPeerIdentity's own docs on
// why — a peer is never told anyone's real account id), so this is how
// "friend-request" resolves that displayId back to the real account it
// currently belongs to. Kept in lockstep with `connections` — set wherever
// a ConnectionState's displayId is established (every "hello"), removed on
// that same connection's close.
const connectionsByDisplayId = new Map<string, string>()

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

// The identity fields a peer is allowed to see about someone — pulled into
// one place so "matched" and "peer-updated" can't quietly drift apart on
// which fields they include. `userId` (the real Google account id) is
// deliberately never included here.
function toPublicIdentity(state: ConnectionState): PublicPeerIdentity {
  return {
    displayId: state.displayId,
    handle: state.handle,
    username: state.username,
    gender: state.gender,
    profilePhoto: state.profilePhoto,
  }
}

function roomPartner(state: ConnectionState): ConnectionState | undefined {
  if (!state.roomId) return undefined
  const room = matchmaker.getRoom(state.roomId)
  if (!room) return undefined
  const partnerId = room.a === state.userId ? room.b : room.a
  return connections.get(partnerId)
}

/** The full current friends/requests/blocks picture for this account — sent after every successful "hello", and re-sent to whoever's affected (if they're online) after any friends-related action, so every open tab converges on the same state without diffing granular events itself. */
async function sendFriendsSnapshot(state: ConnectionState) {
  const [friends, requestsReceived, requestsSent, blocked] = await Promise.all([
    listFriends(state.userId),
    listPendingRequestsReceived(state.userId),
    listPendingRequestsSent(state.userId),
    listBlockedByUserWithUsernames(state.userId),
  ])
  send(state.ws, {
    type: "friends-snapshot",
    friends: friends.map((f) => ({
      id: f.friendshipId,
      userId: f.userId,
      username: f.username,
      online: connections.has(f.userId),
      since: f.since,
    })),
    requestsReceived: requestsReceived.map((r) => ({
      id: r.requestId,
      senderId: r.senderId,
      username: r.username,
      createdAt: r.createdAt,
    })),
    requestsSent: requestsSent.map((r) => ({ id: r.requestId, recipientId: r.recipientId, createdAt: r.createdAt })),
    blocked: blocked.map((b) => ({ userId: b.userId, username: b.username })),
  })
}

/** Re-sends a snapshot to an account only if they're currently connected — used after a friends action affects someone other than the account that triggered it. */
async function refreshSnapshotIfOnline(userId: string) {
  const state = connections.get(userId)
  if (state) await sendFriendsSnapshot(state)
}

/**
 * Tells every currently-connected account how many accounts are online —
 * called whenever that number changes (a connect or a disconnect), so
 * someone sitting in "Finding someone…" sees it update live instead of only
 * reflecting the moment they themselves connected. `connections.size`
 * counts distinct accounts, not sockets/tabs (see the "hello" handler's
 * dedup of a second tab on the same account), so it's genuinely "people",
 * not "browser tabs".
 *
 * O(n) sends per connect/disconnect — fine at this app's current scale (one
 * in-memory realtime process, per server/matchmaker.ts's own doc comment);
 * would need throttling or a push-on-interval design well before that
 * stopped being true.
 */
function broadcastOnlineCount() {
  const count = connections.size
  for (const state of connections.values()) {
    send(state.ws, { type: "online-count", count })
  }
}

async function tryMatch(state: ConnectionState) {
  const room = await matchmaker.enqueue({
    userId: state.userId,
    gender: state.gender,
    enqueuedAt: Date.now(),
  })
  if (!room) {
    console.log("ws-server: queued", { userId: state.userId })
    send(state.ws, { type: "queued" })
    return
  }

  const aState = connections.get(room.a)
  const bState = connections.get(room.b)
  if (!aState || !bState) {
    console.warn("ws-server: matchmaker returned a room with a missing connection", {
      roomId: room.id,
      hasA: Boolean(aState),
      hasB: Boolean(bState),
    })
    return
  }

  aState.roomId = room.id
  bState.roomId = room.id
  const alreadyFriends = await areFriends(room.a, room.b)
  console.log("ws-server: matched", { roomId: room.id, a: room.a, b: room.b })
  send(aState.ws, {
    type: "matched",
    roomId: room.id,
    initiator: true,
    peer: toPublicIdentity(bState),
    alreadyFriends,
  })
  send(bState.ws, {
    type: "matched",
    roomId: room.id,
    initiator: false,
    peer: toPublicIdentity(aState),
    alreadyFriends,
  })
}

function leaveCurrentRoom(state: ConnectionState, notifyPartner: boolean) {
  if (!state.roomId) return
  const roomId = state.roomId
  const partner = roomPartner(state)
  matchmaker.leaveRoom(state.userId)
  state.roomId = null
  if (notifyPartner && partner) {
    partner.roomId = null
    send(partner.ws, { type: "peer-left", roomId })
  }
}

// Per-connection spam guard. A sliding window (not a fixed counter that
// resets in bulk) so a burst right at a window boundary can't double up.
// The limit is generous enough for a real call's normal traffic — WebRTC
// renegotiation alone can burst several ICE candidates a second — while
// still capping a connection that floods find/skip/chat.
const RATE_WINDOW_MS = 2000
const RATE_LIMIT = 60
// Well past the point any legitimate client could reach — a connection this
// abusive gets dropped outright instead of just having messages ignored.
const RATE_HARD_LIMIT = 300

function createRateLimiter() {
  const timestamps: number[] = []
  return function checkRate(): "ok" | "drop" | "abuse" {
    const now = Date.now()
    while (timestamps.length > 0 && now - timestamps[0] > RATE_WINDOW_MS) {
      timestamps.shift()
    }
    timestamps.push(now)
    if (timestamps.length > RATE_HARD_LIMIT) return "abuse"
    if (timestamps.length > RATE_LIMIT) return "drop"
    return "ok"
  }
}

export function createRizzunoWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true })

  wss.on("connection", (ws: WebSocket) => {
    let state: ConnectionState | null = null
    const checkRate = createRateLimiter()
    // Block/report/match checks are now real database round trips, so
    // handling one message can involve a genuine await. Messages from the
    // same connection must still be handled in the order they arrived, one
    // at a time — otherwise two rapid "find"/"skip" presses could each
    // start their own concurrent matchmaker.enqueue() call for the same
    // connection (spec: "race conditions when rapidly pressing skip").
    // Chaining onto this promise serializes them without blocking the
    // event loop for anyone else.
    let processingChain: Promise<void> = Promise.resolve()

    ws.on("message", (raw: RawData) => {
      const rate = checkRate()
      if (rate === "abuse") {
        ws.close(1008, "rate limit exceeded")
        return
      }
      if (rate === "drop") return

      let message: ClientMessage
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }

      // Everything below trusts the parsed message's declared shape (it's
      // just TypeScript types at runtime — nothing actually validates a
      // real client sent well-formed fields). A malformed message that
      // doesn't match its declared type would otherwise throw (or reject),
      // which — uncaught — crashes the entire process for every connected
      // user, not just this one. One bad frame must only ever cost this
      // one connection.
      processingChain = processingChain
        .then(() => handleParsedMessage(message))
        .catch((err: unknown) => {
          // A handler threw — e.g. a database round trip (isBlockedEitherWay,
          // sendFriendRequest, ...) failed. This used to be swallowed
          // silently here, which for "find"/"skip" specifically meant the
          // client had already optimistically flipped to "searching" (see
          // findMatch() in useMatchmaking.ts) and would then just sit there
          // forever with nothing — no "queued", no "matched", no error —
          // ever arriving to move it on. Log it so it's traceable, and tell
          // the client so it isn't left hanging; the connection itself stays
          // open either way (one bad/failed message must only ever cost
          // itself, not the whole connection).
          console.error("ws-server: message handling failed", {
            type: message.type,
            userId: state?.userId,
            error: err instanceof Error ? err.message : String(err),
          })
          if (state && (message.type === "find" || message.type === "skip")) {
            send(state.ws, { type: "error", message: "Couldn't find a match right now. Retrying…", context: "find" })
          } else if (message.type === "hello") {
            // hello threw before "ready" could be sent (e.g. getUserStatus
            // or sendFriendsSnapshot hit a real database error) — `state`
            // is likely still null at this point (it's only assigned after
            // those calls succeed), so there's no ConnectionState to send
            // through; use the raw socket directly. Without this, the
            // client has no way to distinguish "still waiting on a slow
            // server" from "this hello is never going to succeed" and
            // would just sit there forever with no "ready" and no error —
            // see hooks/useMatchmaking.ts's "error" handling for what it
            // does with this (retries hello after a short delay).
            send(ws, {
              type: "error",
              message: "Couldn't set up your connection right now. Retrying…",
              context: "hello",
            })
          }
        })

      async function handleParsedMessage(message: ClientMessage) {
      if (message.type === "hello") {
        console.log("ws-server: hello received")
        if (typeof message.ticket !== "string" || typeof message.handle !== "string") {
          console.warn("ws-server: hello malformed — missing ticket/handle")
          return
        }

        // The one place a client-supplied identity claim is verified rather
        // than trusted — everything downstream (matching, blocks, reports,
        // moderation) uses `userId` from here, never anything the client
        // said about itself directly.
        const verified = verifyTicket(message.ticket)
        if (!verified) {
          console.warn("ws-server: hello rejected — invalid or expired ticket")
          send(ws, { type: "rejected", reason: "invalid_ticket" })
          return
        }
        const { userId } = verified

        // Defense in depth: the ticket route already refuses to mint a
        // ticket for a banned/suspended/deleted account, but a ticket is
        // valid for up to two minutes — re-check here (against the shared
        // database, not a local cache) in case status changed in that
        // window, on a different instance, or via the admin console.
        const status = await getUserStatus(userId)
        if (status.deleted || status.banned) {
          console.warn("ws-server: hello rejected — account banned/deleted", { userId })
          send(ws, { type: "rejected", reason: "banned" })
          ws.close(1008, "account banned")
          return
        }
        if (status.suspendedUntil) {
          console.warn("ws-server: hello rejected — account suspended", { userId })
          send(ws, { type: "rejected", reason: "suspended" })
          ws.close(1008, "account suspended")
          return
        }

        // Also re-sent whenever the user updates their username, gender, or
        // profile photo, not only on first connect — preserve any room
        // they're currently in rather than assuming this is a fresh
        // reconnect with nothing left to carry forward.
        const existing = connections.get(userId)
        // A second "hello" for the same account on a *different* socket
        // means the old one is superseded (e.g. a duplicated tab, or a
        // reconnect that raced with the old socket's own close) — close it
        // rather than leaving it dangling in memory with no room and no
        // future messages.
        if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close()
        }

        const handle = sanitizeText(message.handle, MAX_HANDLE_LENGTH) || "Someone"
        const rawUsername = sanitizeText(message.username, MAX_USERNAME_LENGTH)
        // A username that trips the basic content filter is dropped rather
        // than rejecting the whole connection — falls back to the cosmetic
        // handle instead. This is a basic keyword filter, not real
        // moderation (see lib/textFilter.ts).
        const username = rawUsername && !containsSevereContent(rawUsername) ? rawUsername : undefined

        state = {
          ws,
          userId,
          displayId: existing?.displayId ?? randomUUID(),
          handle,
          username,
          gender: message.gender,
          profilePhoto: message.profilePhoto,
          roomId: existing?.roomId ?? null,
        }
        connections.set(userId, state)
        connectionsByDisplayId.set(state.displayId, userId)

        // If they're mid-call, their partner is already showing a "matched"
        // snapshot of them from whenever the room started — push a refresh
        // so a profile change (e.g. picking/changing a username) actually
        // shows up live instead of only on the next match.
        if (state.roomId) {
          const partner = roomPartner(state)
          if (partner) {
            send(partner.ws, {
              type: "peer-updated",
              roomId: state.roomId,
              peer: toPublicIdentity(state),
            })
          }
        }

        await sendFriendsSnapshot(state)

        // The explicit ack the client waits for before it's allowed to send
        // "find" — sent last, once this connection is actually registered in
        // `connections`/`connectionsByDisplayId` and its friends-snapshot has
        // gone out, so "ready" really does mean "the server is ready".
        console.log("ws-server: hello accepted — sending ready", { userId, displayId: state.displayId })
        send(ws, { type: "ready" })

        // A reconnect on an account that was already counted doesn't change
        // `connections.size` (the old entry is overwritten in place, not
        // added to), so this only actually changes the number — and is only
        // worth a broadcast to everyone else — the first time this account
        // shows up. `existing` was read before `connections.set()` above.
        if (!existing) broadcastOnlineCount()
        else send(ws, { type: "online-count", count: connections.size })
        return
      }

      if (!state) {
        // A message other than "hello" arrived before hello finished (or on
        // a connection that never said hello at all). With the client now
        // gating "find" on the "ready" ack, this should only happen for a
        // stray/malicious frame — logged so a production report of "stuck
        // searching forever" can be told apart from this from an actual
        // dropped "ready".
        console.warn("ws-server: message before hello — ignoring", { type: message.type })
        return
      }

      switch (message.type) {
        case "find":
        case "skip": {
          console.log("ws-server: find received", { userId: state.userId, type: message.type })
          leaveCurrentRoom(state, true)
          await tryMatch(state)
          break
        }
        case "leave": {
          leaveCurrentRoom(state, true)
          matchmaker.removeFromQueue(state.userId)
          break
        }
        case "signal": {
          const partner = roomPartner(state)
          if (partner && partner.roomId === message.roomId) {
            send(partner.ws, { type: "signal", roomId: message.roomId, data: message.data })
          }
          break
        }
        case "typing": {
          const partner = roomPartner(state)
          if (partner && partner.roomId === message.roomId) {
            send(partner.ws, { type: "typing", roomId: message.roomId })
          }
          break
        }
        case "chat": {
          const partner = roomPartner(state)
          if (!partner || partner.roomId !== message.roomId) break

          const content = message.content
          if (content.kind === "text") {
            const text = sanitizeText(content.text, 500)
            if (!text || containsSevereContent(text)) {
              send(state.ws, { type: "error", message: "Message blocked." })
              break
            }
            send(partner.ws, {
              type: "chat",
              roomId: message.roomId,
              from: "peer",
              content: { kind: "text", text },
              ts: Date.now(),
            })
          } else if (
            content.kind === "image" &&
            typeof content.dataUrl === "string" &&
            content.dataUrl.length <= MAX_CHAT_IMAGE_LENGTH &&
            DATA_URL_IMAGE_PATTERN.test(content.dataUrl)
          ) {
            send(partner.ws, {
              type: "chat",
              roomId: message.roomId,
              from: "peer",
              content: { kind: "image", dataUrl: content.dataUrl },
              ts: Date.now(),
            })
          }
          break
        }
        case "mic-state": {
          const partner = roomPartner(state)
          if (partner && partner.roomId === message.roomId) {
            send(partner.ws, { type: "mic-state", roomId: message.roomId, micEnabled: message.micEnabled })
          }
          break
        }
        case "report": {
          const partner = roomPartner(state)
          if (partner) {
            await fileReport({
              reporterId: state.userId,
              reportedId: partner.userId,
              category: message.category,
              details: sanitizeText(message.details, MAX_REPORT_DETAILS_LENGTH) || undefined,
              matchId: message.roomId,
            })
          }
          send(state.ws, { type: "reported" })
          break
        }
        case "block": {
          const partner = roomPartner(state)
          if (partner) {
            await addBlock(state.userId, partner.userId)
            leaveCurrentRoom(state, true)
            await sendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(partner.userId)
          }
          send(state.ws, { type: "blocked" })
          break
        }
        case "friend-request": {
          const targetUserId = connectionsByDisplayId.get(message.targetDisplayId)
          if (!targetUserId || !connections.has(targetUserId)) {
            send(state.ws, { type: "friend-request-result", targetDisplayId: message.targetDisplayId, result: "peer_offline" })
            break
          }
          const result = await sendFriendRequest(state.userId, targetUserId)
          send(state.ws, { type: "friend-request-result", targetDisplayId: message.targetDisplayId, result: result.status })
          if (result.status === "sent" || result.status === "auto_accepted") {
            await sendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(targetUserId)
          }
          break
        }
        case "friend-respond": {
          const result = await respondToFriendRequest(state.userId, message.requestId, message.accept)
          if (result.status !== "not_found") {
            await sendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(result.senderId)
          }
          break
        }
        case "unfriend": {
          const result = await removeFriendship(state.userId, message.friendshipId)
          if (result) {
            await sendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(result.otherId)
          }
          break
        }
        case "friend-block": {
          if (message.targetUserId && message.targetUserId !== state.userId) {
            await addBlock(state.userId, message.targetUserId)
            await sendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(message.targetUserId)
          }
          break
        }
        default:
          break
      }
      }
    })

    ws.on("close", () => {
      if (!state) return
      // Only this socket's own entry, and only if it's still the live one —
      // a superseded old socket (second-tab dedup, see "hello" above, or a
      // reconnect that raced with the old socket's own close) closing after
      // a newer one already took its place in `connections` must not touch
      // ANY of the newer connection's state. Checked first, before anything
      // else below runs, specifically because `leaveCurrentRoom` and
      // `removeFromQueue` operate on `state.userId` — not on this specific
      // socket/ConnectionState object — so without this guard, an old
      // socket's belated close event would tear down whatever room or queue
      // entry the *new* socket had already re-established for that same
      // userId (e.g. a fresh "find" the new connection just sent), even
      // though that account is still very much online.
      const wasCurrent = connections.get(state.userId) === state
      if (!wasCurrent) {
        console.log("ws-server: close on a superseded socket — leaving the current connection's state alone", {
          userId: state.userId,
        })
        return
      }
      leaveCurrentRoom(state, true)
      matchmaker.removeFromQueue(state.userId)
      connections.delete(state.userId)
      if (connectionsByDisplayId.get(state.displayId) === state.userId) connectionsByDisplayId.delete(state.displayId)
      broadcastOnlineCount()
    })
  })

  return wss
}
