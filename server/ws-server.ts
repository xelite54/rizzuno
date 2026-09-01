import { randomUUID } from "node:crypto"
import { WebSocketServer, WebSocket } from "ws"
import type { RawData } from "ws"
import { matchmaker } from "./matchmaker"
import type { QueuedClient } from "./matchmaker"
import { MAX_CHAT_IMAGE_LENGTH, isValidGender } from "../lib/signaling/protocol"
import type { ClientMessage, Gender, PublicPeerIdentity, ServerMessage } from "../lib/signaling/protocol"
import { verifyTicket } from "../lib/realtimeTicket"
import {
  getUserStatus,
  addBlock,
  removeBlock,
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
import { moderateImage } from "../lib/imageModeration"

const MAX_HANDLE_LENGTH = 40
const MAX_USERNAME_LENGTH = 24
const MAX_REPORT_DETAILS_LENGTH = 500
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i

type ConnectionState = {
  ws: WebSocket
  /** The Google account's own stable id — verified from the "hello" ticket, never taken from any other client-supplied field. */
  userId: string
  /** Random per-connection token, unrelated to `userId` — this, not the real account id, is what a matched peer actually sees (see PublicPeerIdentity in lib/signaling/protocol.ts), and what this file's own diagnostic logs use instead of `userId`. */
  displayId: string
  handle: string
  username?: string
  gender?: Gender
  profilePhoto?: string | null
  roomId: string | null
  /**
   * Authoritative server-side matching INTENT — true exactly when this
   * account currently wants to be actively found a match (has sent "find"/
   * "skip" and nothing has cancelled that since). This is what
   * `connections.has(userId)` alone used to stand in for, insufficiently:
   * an account stays present in `connections` for as long as its socket is
   * open, which says nothing about whether it's still SEEKING right now —
   * it could have explicitly paused, turned its camera off (which sends the
   * same "leave" — see hooks/useMatchmaking.ts's `leaveQueueOnly`), or be
   * sitting mid-call already. Set true the instant "find"/"skip" is
   * RECEIVED (synchronously, before any async processing — see the
   * "message" handler below) and false the instant "leave" is received or
   * the socket closes — never delayed behind an in-flight async match
   * attempt for this same connection.
   */
  seeking: boolean
  /**
   * Increments on every event that changes this account's search
   * intent — "find"/"skip" (a new search begins) and "leave"/pause/
   * camera-off/disconnect (the current one ends) — always synchronously,
   * at the moment that message is RECEIVED, never queued behind
   * server/matchmaker.ts's async block-check for an EARLIER, still-in-
   * flight "find" from this same connection. A match attempt captures this
   * value the instant it starts and compares against the LIVE value after
   * every async boundary it crosses; any mismatch means this specific
   * attempt has been superseded and must not be allowed to commit — see
   * `makeCheckLive` below and server/matchmaker.ts's `CheckLive`.
   */
  searchGeneration: number
  /** The last "profile-update" revision this connection actually applied. Starts at 0 — the "hello" snapshot itself counts as revision 0 — so the first real profile-update only needs revision 1. A message whose revision isn't strictly greater than this is stale (arrived out of order relative to one already applied) and is dropped. */
  profileRevision: number
}

// userId -> live connection. A reconnect (e.g. after a network blip) simply
// overwrites its old entry; the old socket's own "close" handler cleans up
// its room membership (see cleanUpAccount(), also used for the same-socket
// account-switch case below).
const connections = new Map<string, ConnectionState>()

// The reverse of the map above, specifically for friend requests: sending
// one only ever names a displayId (see PublicPeerIdentity's own docs on
// why — a peer is never told anyone's real account id), so this is how
// "friend-request" resolves that displayId back to the real account it
// currently belongs to. Kept in lockstep with `connections` — set wherever
// a ConnectionState's displayId is established (every "hello"), removed by
// cleanUpAccount().
const connectionsByDisplayId = new Map<string, string>()

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

/** Formats a thrown value into the field actually worth logging — never the full stack in production noise, just a message string. Mirrors lib/db.ts's describeDbError but generic to any error, not just Postgres ones. */
function describeErr(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
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

/**
 * Builds this connection's authoritative eligibility check — passed into
 * server/matchmaker.ts's `reserveMatch` and reused again for the final
 * pre-commit check (see `tryMatch`). Freshly looks up `userId` in
 * `connections` every time (never trusts a snapshot) and verifies ALL of:
 * still registered, on an OPEN socket, still `seeking`, on the exact
 * `searchGeneration` being asked about, and not already in a room.
 *
 * `expectedInitiatorState` is the ONE case this file actually has a
 * captured object reference for (the connection that called "find" in the
 * first place) — when checking that specific userId, this also verifies
 * `connections.get(userId) === expectedInitiatorState` by reference, not
 * just by matching fields, which catches a same-socket account-switch or a
 * same-account-different-socket supersede that a fields-only check could in
 * principle miss for a single tick. Every OTHER account this checks (a
 * candidate server/matchmaker.ts is considering) never had a captured
 * reference to compare against in the first place — generation matching is
 * what proves those are still current instead.
 */
function makeCheckLive(expectedInitiatorState: ConnectionState) {
  return function checkLive(userId: string, expectedGeneration: number): { live: boolean; gender?: Gender } {
    const s = connections.get(userId)
    if (!s) return { live: false }
    if (userId === expectedInitiatorState.userId && s !== expectedInitiatorState) return { live: false }
    if (s.ws.readyState !== WebSocket.OPEN) return { live: false }
    if (!s.seeking) return { live: false }
    if (s.searchGeneration !== expectedGeneration) return { live: false }
    if (s.roomId) return { live: false }
    return { live: true, gender: s.gender }
  }
}

/**
 * `searchGeneration` is passed in explicitly — deliberately NEVER read off
 * `state.searchGeneration` here. This function used to read the live field
 * directly, which meant a `tryMatch` call still sitting on the serialized
 * `processingChain` for an OLDER "find"/"skip" (see the "message" handler's
 * pre-mutation block) could build its queued snapshot from whatever
 * generation the account is CURRENTLY on by the time its turn finally
 * comes up — not the generation this specific attempt actually started
 * under — if a later find/skip/leave had already bumped it in the
 * meantime. Callers must pass the exact `expectedGeneration` the attempt
 * was captured under (see `tryMatch`, which also aborts outright if that
 * no longer matches the live value before ever reaching this function).
 */
function toQueuedClient(state: ConnectionState, searchGeneration: number): QueuedClient {
  return {
    userId: state.userId,
    gender: state.gender,
    enqueuedAt: Date.now(),
    debugId: state.displayId,
    searchGeneration,
  }
}

/** The full current friends/requests/blocks picture for this account — sent right after "ready" (best-effort, never a prerequisite for it — see the "hello" handler), and re-sent to whoever's affected (if they're online) after any friends-related action, so every open tab converges on the same state without diffing granular events itself. */
async function sendFriendsSnapshot(state: ConnectionState) {
  const [friends, requestsReceived, requestsSent, blocked] = await Promise.all([
    listFriends(state.userId),
    listPendingRequestsReceived(state.userId),
    listPendingRequestsSent(state.userId),
    listBlockedByUserWithUsernames(state.userId),
  ])

  // Temporary diagnostic for the blank-friend-username investigation — safe
  // to leave in (or remove once confirmed fixed): counts only, never a real
  // account id or username itself. `missingUsernames` should always be 0 —
  // onboarding requires a username before matching (and therefore friending)
  // ever works; a nonzero count here means an upstream write actually left
  // a friend's `users.username` NULL despite that, worth chasing from here
  // rather than guessing client-side.
  const missingUsernames = friends.filter((f) => !f.username).length
  console.log("ws-server: friends snapshot", {
    displayId: state.displayId,
    friendCount: friends.length,
    usernames: friends.map((f) => Boolean(f.username)),
    missingUsernames,
  })
  if (missingUsernames > 0) {
    console.warn("ws-server: confirmed friend(s) with no username in the snapshot — upstream data issue, not a display bug", {
      displayId: state.displayId,
      missingUsernames,
    })
  }

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

/**
 * A Friends-DB failure must never propagate into matchmaking or crash a
 * connection — every call site that used to `await sendFriendsSnapshot`
 * directly now goes through this instead, which logs and swallows instead
 * of throwing. Friends may be temporarily unavailable; matching must not be.
 */
async function trySendFriendsSnapshot(state: ConnectionState) {
  try {
    await sendFriendsSnapshot(state)
  } catch (err) {
    console.error("ws-server: friends snapshot failed — friends feature degraded, unrelated to matchmaking", {
      displayId: state.displayId,
      ...describeErr(err),
    })
  }
}

/** Re-sends a snapshot to an account only if they're currently connected — used after a friends action affects someone other than the account that triggered it. */
async function refreshSnapshotIfOnline(userId: string) {
  const state = connections.get(userId)
  if (state) await trySendFriendsSnapshot(state)
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

/**
 * Two-phase match attempt. `expectedGeneration` is captured by the CALLER
 * at the exact moment the triggering message was received (synchronously,
 * before this async function ever starts) — see the "message" handler's
 * pre-mutation block for "find"/"skip", and the "profile-update"/"unblock"
 * re-evaluation call sites, which just read the current value since they
 * aren't starting a NEW search intent.
 *
 * The FIRST thing this does is compare `expectedGeneration` against the
 * LIVE `state.searchGeneration` and abort outright on any mismatch — before
 * ever touching the matchmaker. This matters specifically for "find"/
 * "skip": `expectedGeneration` was captured at raw message-RECEIPT time,
 * but this function doesn't actually run until its turn comes up on the
 * serialized `processingChain` (see the "message" handler), which can be
 * arbitrarily later if other messages for this same connection are still
 * being processed ahead of it. A LATER find/skip/leave for this same
 * connection can (and does, via that same synchronous pre-mutation block)
 * bump `state.searchGeneration` again in that gap — so without this check,
 * an OLDER, already-superseded "find" could still reach `reserveMatch` and
 * build/commit a match using whatever generation the account happens to be
 * on by the time it finally runs, not the one it actually started under.
 *
 * Two more async boundaries get crossed after that — server/matchmaker.ts's
 * own block check inside `reserveMatch`, and the Friends lookup right
 * after — and EVERY condition in `makeCheckLive` is re-verified, for BOTH
 * accounts, after each one. The recent-partner cooldown is recorded
 * (`commitMatch`) only once "matched" has actually been dispatched to two
 * confirmed-OPEN sockets — never before.
 */
async function tryMatch(state: ConnectionState, expectedGeneration: number) {
  if (state.searchGeneration !== expectedGeneration) {
    console.log("ws-server: find superseded before it could even start — aborting", {
      displayId: state.displayId,
      expectedGeneration,
      liveGeneration: state.searchGeneration,
    })
    return
  }

  const checkLive = makeCheckLive(state)
  const room = await matchmaker.reserveMatch(toQueuedClient(state, expectedGeneration), checkLive)
  if (!room) {
    // Only acknowledge "queued" if THIS specific find/skip is still the
    // account's current one — a stale (superseded) attempt resolving late
    // must not resurrect a "queued" ack after the guest has since paused,
    // left, or started an entirely different search.
    if (state.searchGeneration === expectedGeneration && state.seeking && !state.roomId) {
      console.log("ws-server: queue entered", { displayId: state.displayId, queueSize: matchmaker.queueSize })
      send(state.ws, { type: "queued" })
    } else {
      console.log("ws-server: find superseded before queueing — dropping the stale 'queued' ack", {
        displayId: state.displayId,
      })
    }
    return
  }

  // A Friends-DB failure must never cancel a valid core match — computed
  // before the final check below specifically so that check (and the
  // commit that follows it) is the very LAST thing that happens, with no
  // further async gap after it.
  let alreadyFriends = false
  try {
    alreadyFriends = await areFriends(room.a, room.b)
  } catch (err) {
    console.error("ws-server: areFriends failed — proceeding without it, match still commits", {
      roomId: room.id,
      ...describeErr(err),
    })
  }

  // FINAL verification — fully synchronous from here through the sends
  // below, so nothing can go stale in the gap between checking and
  // dispatching. Re-checks everything `reserveMatch` already checked once
  // (that check happened before the Friends-lookup await above, which is
  // itself a real async boundary either side could have gone stale across).
  const aCheck = checkLive(room.a, room.aGeneration)
  const bCheck = checkLive(room.b, room.bGeneration)
  const pairStillOpposite = Boolean(aCheck.gender && bCheck.gender && aCheck.gender !== bCheck.gender)

  if (!aCheck.live || !bCheck.live || !pairStillOpposite) {
    console.warn("ws-server: pair rollback — no longer eligible right before commit", {
      roomId: room.id,
      aLive: aCheck.live,
      bLive: bCheck.live,
      pairStillOpposite,
    })
    matchmaker.deleteReservation(room.id)
    // Requeue whichever side(s) are STILL individually eligible — even if
    // the PAIR is no longer valid together (e.g. a gender change mid-
    // lookup made them no longer opposite), each side that's still
    // genuinely seeking deserves a fresh chance at a different partner
    // rather than being silently dropped from the queue.
    const aState = connections.get(room.a)
    const bState = connections.get(room.b)
    // room.aGeneration/room.bGeneration, not a fresh read of
    // aState.searchGeneration/bState.searchGeneration — aCheck/bCheck above
    // already confirmed (via checkLive) that the live value equals this
    // exact generation, synchronously, with no `await` since; requeuing
    // under it is what's actually been verified, not a value that could in
    // principle have drifted again by this point.
    if (aCheck.live && aState) {
      matchmaker.requeue(toQueuedClient(aState, room.aGeneration))
      send(aState.ws, { type: "queued" })
    }
    if (bCheck.live && bState) {
      matchmaker.requeue(toQueuedClient(bState, room.bGeneration))
      send(bState.ws, { type: "queued" })
    }
    return
  }

  const aState = connections.get(room.a)!
  const bState = connections.get(room.b)!
  aState.roomId = room.id
  bState.roomId = room.id
  aState.seeking = false
  bState.seeking = false

  send(aState.ws, { type: "matched", roomId: room.id, initiator: true, peer: toPublicIdentity(bState), alreadyFriends })
  console.log("ws-server: matched sent to A", { roomId: room.id, displayId: aState.displayId })
  send(bState.ws, { type: "matched", roomId: room.id, initiator: false, peer: toPublicIdentity(aState), alreadyFriends })
  console.log("ws-server: matched sent to B", { roomId: room.id, displayId: bState.displayId })

  // Recorded ONLY now — after both "matched" sends, both to sockets this
  // function itself just confirmed were OPEN with no async gap in between
  // (see the class doc comment on why that ordering is the entire point).
  matchmaker.commitMatch(room.id)
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

/**
 * Fully removes one account's server-side state — leaves any room, drops
 * any queue entry, and clears both connection maps. The one authoritative
 * cleanup path, used by BOTH a genuine socket close (see the "close"
 * handler) and a same-socket account switch (a fresh "hello" for a
 * *different* account arriving on an already-authenticated socket — see
 * the "hello" handler) — a physical socket must never represent more than
 * one live account at a time, and this is what guarantees the old one is
 * completely gone from `connections`/the matchmaker queue/any room before
 * the new one is ever attached.
 *
 * A no-op if `oldState` is no longer the live entry for its own userId (a
 * stale/superseded state object calling this must never clobber whatever's
 * actually live now for that same userId).
 */
function cleanUpAccount(oldState: ConnectionState) {
  const wasCurrent = connections.get(oldState.userId) === oldState
  if (!wasCurrent) {
    console.log("ws-server: cleanup skipped — this state was already superseded", { displayId: oldState.displayId })
    return
  }
  leaveCurrentRoom(oldState, true)
  matchmaker.removeFromQueue(oldState.userId)
  oldState.seeking = false
  oldState.searchGeneration += 1
  connections.delete(oldState.userId)
  if (connectionsByDisplayId.get(oldState.displayId) === oldState.userId) {
    connectionsByDisplayId.delete(oldState.displayId)
  }
  console.log("ws-server: queue removed", { displayId: oldState.displayId })
  broadcastOnlineCount()
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
    console.log("ws-server: connection accepted")
    let state: ConnectionState | null = null
    const checkRate = createRateLimiter()
    // Block/report/match checks are now real database round trips, so
    // handling one message can involve a genuine await. Messages from the
    // same connection must still be handled in the order they arrived, one
    // at a time — otherwise two rapid "find"/"skip" presses could each
    // start their own concurrent matchmaker.reserveMatch() call for the
    // same connection (spec: "race conditions when rapidly pressing skip").
    // Chaining onto this promise serializes them without blocking the
    // event loop for anyone else.
    //
    // IMPORTANT EXCEPTION — "find"/"skip"/"leave" each ALSO get a small,
    // synchronous mutation applied immediately below, OUTSIDE this chain,
    // at the moment the message is received. That's deliberate: this
    // serialization means a "leave" sent right after a "find" would
    // otherwise sit BEHIND that find's entire async match attempt (its DB
    // block-check, its Friends lookup) before ever taking effect — long
    // enough for the OLD find to commit a real match the guest had already
    // tried to cancel. `seeking`/`searchGeneration` are updated the instant
    // the message arrives specifically so an in-flight match attempt's own
    // post-await checks (see `makeCheckLive`) see the truth immediately,
    // regardless of how long its OWN processing takes to reach the front of
    // this queue. Everything else about handling that message (e.g.
    // "leave"'s `leaveCurrentRoom`/partner notification) still goes through
    // the normal serialized chain below — only the eligibility-critical
    // fields jump ahead.
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

      // See the IMPORTANT note above `processingChain` — this is that
      // immediate, synchronous mutation, and it happens before this
      // message even joins the serialized chain.
      let capturedGeneration: number | undefined
      if (state) {
        if (message.type === "find" || message.type === "skip") {
          state.seeking = true
          state.searchGeneration += 1
          capturedGeneration = state.searchGeneration
        } else if (message.type === "leave") {
          state.seeking = false
          state.searchGeneration += 1
        }
      }

      // Everything below trusts the parsed message's declared shape (it's
      // just TypeScript types at runtime — nothing actually validates a
      // real client sent well-formed fields). A malformed message that
      // doesn't match its declared type would otherwise throw (or reject),
      // which — uncaught — crashes the entire process for every connected
      // user, not just this one. One bad frame must only ever cost this
      // one connection.
      processingChain = processingChain
        .then(() => handleParsedMessage(message, capturedGeneration))
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
            displayId: state?.displayId,
            ...describeErr(err),
          })
          if (state && (message.type === "find" || message.type === "skip")) {
            send(state.ws, { type: "error", message: "Couldn't find a match right now. Retrying…", context: "find" })
          } else if (message.type === "hello") {
            // hello threw before "ready" could be sent (e.g. getUserStatus
            // hit a real database error) — `state` is likely still null at
            // this point (it's only assigned after those calls succeed), so
            // there's no ConnectionState to send through; use the raw
            // socket directly. Without this, the client has no way to
            // distinguish "still waiting on a slow server" from "this hello
            // is never going to succeed" and would just sit there forever
            // with no "ready" and no error — see hooks/useMatchmaking.ts's
            // "error" handling for what it does with this (retries hello
            // after a short delay).
            send(ws, {
              type: "error",
              message: "Couldn't set up your connection right now. Retrying…",
              context: "hello",
            })
          }
        })

      async function handleParsedMessage(message: ClientMessage, capturedGeneration: number | undefined) {
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
        console.log("ws-server: hello authenticated")

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

        // If THIS SAME socket previously authenticated as a *different*
        // account (sign-out-and-back-in-as-someone-else within one tab,
        // without the socket ever actually closing in between — see
        // AUTHENTICATION MUST OWN THE REALTIME LIFECYCLE), that old
        // account's server-side state must be completely gone before the
        // new one is attached. A no-op if this is the same account
        // re-hello-ing (cleanUpAccount would find its own state already
        // superseded by nothing — but we only call it for an actual
        // account change, so it never runs in that case at all).
        if (state && state.userId !== userId) {
          console.log("ws-server: hello for a new account on an already-authenticated socket — cleaning up the old one first", {
            oldDisplayId: state.displayId,
          })
          cleanUpAccount(state)
        }

        // Also re-sent whenever the user reconnects the same account —
        // preserve any room they're currently in rather than assuming this
        // is a fresh reconnect with nothing left to carry forward.
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
        // Validated the same way "profile-update" validates it below — a
        // malformed/tampered value must never slip into matching as some
        // unhandled third gender.
        const gender = isValidGender(message.gender) ? message.gender : undefined

        state = {
          ws,
          userId,
          displayId: existing?.displayId ?? randomUUID(),
          handle,
          username,
          gender,
          profilePhoto: message.profilePhoto,
          roomId: existing?.roomId ?? null,
          seeking: false,
          searchGeneration: existing?.searchGeneration ?? 0,
          profileRevision: 0,
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

        // The explicit ack the client waits for before it's allowed to send
        // "find" — sent as soon as this connection is authoritatively
        // registered in `connections`/`connectionsByDisplayId`, so "ready"
        // really does mean "the server is ready". Friends is deliberately
        // NOT awaited before this: four optional DB queries must never be a
        // prerequisite for matchmaking working at all (see
        // trySendFriendsSnapshot below).
        console.log("ws-server: ready sent", { displayId: state.displayId })
        send(ws, { type: "ready" })

        // A reconnect on an account that was already counted doesn't change
        // `connections.size` (the old entry is overwritten in place, not
        // added to), so this only actually changes the number — and is only
        // worth a broadcast to everyone else — the first time this account
        // shows up. `existing` was read before `connections.set()` above.
        if (!existing) broadcastOnlineCount()
        else send(ws, { type: "online-count", count: connections.size })

        // Best-effort, asynchronous, never awaited before "ready" above —
        // see trySendFriendsSnapshot's own doc comment.
        void trySendFriendsSnapshot(state)
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
          console.log("ws-server: find received", { displayId: state.displayId, type: message.type })
          leaveCurrentRoom(state, true)
          // capturedGeneration was set synchronously at message-receipt
          // time, above — always defined here (state existed then too,
          // since it still exists now and nothing removes it except a
          // socket close, which would have prevented this handler from
          // running at all).
          await tryMatch(state, capturedGeneration!)
          break
        }
        case "leave": {
          leaveCurrentRoom(state, true)
          matchmaker.removeFromQueue(state.userId)
          // seeking/searchGeneration were already invalidated synchronously
          // at message-receipt time, above — nothing left to do for them
          // here.
          console.log("ws-server: queue removed (explicit leave)", { displayId: state.displayId })
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
            // The same centralized pipeline every profile photo/post goes
            // through (lib/imageModeration) — a chat image is never
            // forwarded to the partner until it comes back "allow". This
            // runs synchronously in the request path (upload → moderate →
            // send), not send-first-moderate-after: nothing reaches the
            // partner's socket unless this resolves to allow. The
            // DATA_URL_IMAGE_PATTERN/MAX_CHAT_IMAGE_LENGTH checks above are
            // just a cheap pre-filter — moderateImage() does its own real,
            // decoded-byte validation regardless (see
            // lib/imageModeration/imageValidation.ts) and is what actually
            // decides whether this is safe to forward, not this regex.
            const moderation = await moderateImage({
              userId: state.userId,
              dataUrl: content.dataUrl,
              surface: "chat",
            })
            if (moderation.decision === "allow") {
              send(partner.ws, {
                type: "chat",
                roomId: message.roomId,
                from: "peer",
                content: { kind: "image", dataUrl: content.dataUrl },
                ts: Date.now(),
              })
            } else {
              send(state.ws, { type: "error", message: "Image blocked." })
            }
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
          let ok = false
          if (partner) {
            try {
              await addBlock(state.userId, partner.userId)
              ok = true
            } catch (err) {
              console.error("ws-server: addBlock failed — block NOT persisted", {
                displayId: state.displayId,
                ...describeErr(err),
              })
            }
            // The interaction ends locally regardless of whether the block
            // actually persisted — safety (getting away from this specific
            // person right now) doesn't wait on a database write; only the
            // *permanent* record depends on that succeeding, and `ok` below
            // tells the client honestly which one actually happened rather
            // than pretending it always persists.
            leaveCurrentRoom(state, true)
            if (ok) {
              await trySendFriendsSnapshot(state)
              await refreshSnapshotIfOnline(partner.userId)
            }
          }
          console.log("ws-server: block", { displayId: state.displayId, ok })
          send(state.ws, { type: "blocked", ok })
          break
        }
        case "unblock": {
          if (!message.targetUserId || message.targetUserId === state.userId) break
          let ok = false
          try {
            ok = await removeBlock(state.userId, message.targetUserId)
          } catch (err) {
            console.error("ws-server: removeBlock failed", { displayId: state.displayId, ...describeErr(err) })
          }
          console.log("ws-server: unblock", { displayId: state.displayId, ok })
          send(state.ws, { type: "unblocked", ok, targetUserId: message.targetUserId })
          if (ok) {
            await trySendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(message.targetUserId)
            // Already actively seeking (server-authoritative) with no
            // active room: whoever was just unblocked is a candidate
            // again, so give this one queue entry a fresh evaluation now
            // rather than leaving it stuck against a now-stale candidate
            // pool until the next explicit find/skip. Not a NEW search
            // intent (seeking/searchGeneration are untouched) — just a
            // re-scan within the currently-active one, so its current
            // generation is captured and reused as-is.
            if (state.seeking && !state.roomId) {
              console.log("ws-server: unblock — re-evaluating queue", { displayId: state.displayId })
              await tryMatch(state, state.searchGeneration)
            }
          }
          break
        }
        case "profile-update": {
          if (typeof message.revision !== "number" || message.revision <= state.profileRevision) {
            console.warn("ws-server: profile-update ignored — stale or invalid revision", {
              displayId: state.displayId,
              revision: message.revision,
              current: state.profileRevision,
            })
            break
          }
          state.profileRevision = message.revision

          const rawUsername = sanitizeText(message.username, MAX_USERNAME_LENGTH)
          const nextUsername = rawUsername && !containsSevereContent(rawUsername) ? rawUsername : state.username
          const nextGender =
            message.gender === undefined ? state.gender : isValidGender(message.gender) ? message.gender : state.gender
          const genderChanged = nextGender !== state.gender

          state.username = nextUsername
          state.gender = nextGender
          if (message.profilePhoto !== undefined) state.profilePhoto = message.profilePhoto

          console.log("ws-server: profile-update applied", {
            displayId: state.displayId,
            revision: state.profileRevision,
            genderChanged,
          })

          if (state.roomId) {
            // ACTIVE: preserve the call itself — just refresh what the
            // partner is shown. The NEXT match (not this one) is what
            // actually uses the new gender for pairing.
            const partner = roomPartner(state)
            if (partner) {
              send(partner.ws, { type: "peer-updated", roomId: state.roomId, peer: toPublicIdentity(state) })
            }
          } else if (state.seeking && genderChanged) {
            // SEARCHING: the queued snapshot's gender is now stale —
            // re-evaluate with the new one immediately (this removes the
            // old queue entry and re-inserts with the updated gender as
            // part of the same reserveMatch() call — see
            // server/matchmaker.ts) rather than leaving a stale entry
            // sitting in the queue until the next explicit find/skip. Not
            // a new search intent, so the current generation is reused.
            console.log("ws-server: gender changed while queued — re-evaluating queue", { displayId: state.displayId })
            await tryMatch(state, state.searchGeneration)
          }
          // PAUSED (no room, not seeking): identity is already updated
          // above; correctly stays outside the queue either way.
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
            await trySendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(targetUserId)
          }
          break
        }
        case "friend-respond": {
          const result = await respondToFriendRequest(state.userId, message.requestId, message.accept)
          if (result.status !== "not_found") {
            await trySendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(result.senderId)
          }
          break
        }
        case "unfriend": {
          const result = await removeFriendship(state.userId, message.friendshipId)
          if (result) {
            await trySendFriendsSnapshot(state)
            await refreshSnapshotIfOnline(result.otherId)
          }
          break
        }
        case "friend-block": {
          if (message.targetUserId && message.targetUserId !== state.userId) {
            try {
              await addBlock(state.userId, message.targetUserId)
            } catch (err) {
              console.error("ws-server: friend-block addBlock failed", { displayId: state.displayId, ...describeErr(err) })
              break
            }
            await trySendFriendsSnapshot(state)
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
      console.log("ws-server: peer disconnected", { displayId: state.displayId })
      cleanUpAccount(state)
    })
  })

  return wss
}
