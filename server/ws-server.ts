import { randomUUID } from "node:crypto"
import { WebSocketServer, WebSocket } from "ws"
import type { RawData } from "ws"
import { matchmaker } from "./matchmaker"
import { MAX_CHAT_IMAGE_LENGTH } from "../lib/signaling/protocol"
import type { ClientMessage, Gender, PublicPeerIdentity, ServerMessage } from "../lib/signaling/protocol"
import { verifyTicket } from "../lib/realtimeTicket"
import { getUserStatus, addBlock, fileReport } from "../lib/db"
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

async function tryMatch(state: ConnectionState) {
  const room = await matchmaker.enqueue({
    userId: state.userId,
    gender: state.gender,
    enqueuedAt: Date.now(),
  })
  if (!room) {
    send(state.ws, { type: "queued" })
    return
  }

  const aState = connections.get(room.a)
  const bState = connections.get(room.b)
  if (!aState || !bState) return

  aState.roomId = room.id
  bState.roomId = room.id
  send(aState.ws, {
    type: "matched",
    roomId: room.id,
    initiator: true,
    peer: toPublicIdentity(bState),
  })
  send(bState.ws, {
    type: "matched",
    roomId: room.id,
    initiator: false,
    peer: toPublicIdentity(aState),
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
        .catch(() => {
          // Drop the malformed/failed message; the connection itself stays open.
        })

      async function handleParsedMessage(message: ClientMessage) {
      if (message.type === "hello") {
        if (typeof message.ticket !== "string" || typeof message.handle !== "string") {
          return
        }

        // The one place a client-supplied identity claim is verified rather
        // than trusted — everything downstream (matching, blocks, reports,
        // moderation) uses `userId` from here, never anything the client
        // said about itself directly.
        const verified = verifyTicket(message.ticket)
        if (!verified) {
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
          send(ws, { type: "rejected", reason: "banned" })
          ws.close(1008, "account banned")
          return
        }
        if (status.suspendedUntil) {
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
        return
      }

      if (!state) return // must say hello first

      switch (message.type) {
        case "find":
        case "skip": {
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
          }
          send(state.ws, { type: "blocked" })
          break
        }
        default:
          break
      }
      }
    })

    ws.on("close", () => {
      if (!state) return
      leaveCurrentRoom(state, true)
      matchmaker.removeFromQueue(state.userId)
      if (connections.get(state.userId) === state) connections.delete(state.userId)
    })
  })

  return wss
}
