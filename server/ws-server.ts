import { randomUUID } from "node:crypto"
import { WebSocketServer, WebSocket } from "ws"
import type { RawData } from "ws"
import { matchmaker } from "./matchmaker"
import type { QueuedClient } from "./matchmaker"
import { MAX_CHAT_IMAGE_LENGTH, isValidGender, WS_CLOSE_SUPERSEDED } from "../lib/signaling/protocol"
import type { ClientMessage, Gender, PublicPeerIdentity, ServerMessage } from "../lib/signaling/protocol"
import { verifyTicket } from "../lib/realtimeTicket"
import {
  getUserStatus,
  getAccountGender,
  getPublicProfile,
  claimAccountGender,
  addBlock,
  removeBlock,
  fileReport,
  areFriends,
  isBlockedEitherWay,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriendship,
  listFriends,
  listPendingRequestsReceived,
  listPendingRequestsSent,
  listBlockedByUserWithUsernames,
  sendFriendMessage,
  markFriendMessagesRead,
  countUnreadFriendMessages,
  getFriendshipOtherUser,
} from "../lib/db"
import { sanitizeText, containsSevereContent, containsBlockedChatContent } from "../lib/textFilter"
import { moderateImage } from "../lib/imageModeration"

const MAX_HANDLE_LENGTH = 40

type FriendInvitation = { id: string; sender: ConnectionState; recipient: ConnectionState; expiresAt: number; timer: ReturnType<typeof setTimeout> }
const friendInvitations = new Map<string, FriendInvitation>()

function publishInvitations(state: ConnectionState) {
  send(state.ws, { type: "match-invitations", invitations: [...friendInvitations.values()]
    .filter((invite) => invite.sender === state || invite.recipient === state)
    .map((invite) => {
      const incoming = invite.recipient === state
      const other = incoming ? invite.sender : invite.recipient
      return { id: invite.id, userId: other.userId, username: other.username ?? other.handle, expiresAt: invite.expiresAt, direction: incoming ? "incoming" : "outgoing" }
    }) })
}

function removeInvitation(invite: FriendInvitation) {
  clearTimeout(invite.timer)
  friendInvitations.delete(invite.id)
  publishInvitations(invite.sender)
  publishInvitations(invite.recipient)
}

function cancelInvitations(state: ConnectionState) {
  for (const invite of friendInvitations.values()) {
    if (invite.sender === state || invite.recipient === state) removeInvitation(invite)
  }
}

function availableForInvitation(state: ConnectionState): boolean {
  // `isAlive` (heartbeat liveness — see ConnectionState's own doc comment)
  // is a real, if partial, improvement over `readyState === OPEN` alone: a
  // connection that's genuinely vanished (backgrounded and killed, a lost
  // signal) without a clean close can show OPEN for a long time otherwise.
  // It does NOT prove the browser can actually start WebRTC right now
  // (a tab can still be alive-per-heartbeat while stale/throttled/slow to
  // resume JS execution) — that's what the rtc-ready handshake (see
  // "match-invite-respond"'s own doc comment, and the "rtc-ready" case
  // below) is the actual, final authority for. This is only ever the
  // FIRST, cheap filter for "is there any point even trying".
  return (
    connections.get(state.userId) === state &&
    state.ws.readyState === WebSocket.OPEN &&
    state.isAlive &&
    !state.roomId &&
    !state.seeking
  )
}

async function friendsMayCall(a: ConnectionState, b: ConnectionState): Promise<boolean> {
  const [friends, blocked, aStatus, bStatus] = await Promise.all([
    areFriends(a.userId, b.userId), isBlockedEitherWay(a.userId, b.userId), getUserStatus(a.userId), getUserStatus(b.userId),
  ])
  return friends && !blocked && [aStatus, bStatus].every((status) => !status.banned && !status.deleted && !(status.suspendedUntil && status.suspendedUntil > Date.now()))
}

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
  countryCode?: string
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
  /**
   * Heartbeat liveness, not transport state — `ws.readyState === OPEN` only
   * means the TCP connection hasn't been torn down yet, which for a client
   * that vanished without a clean close (lost signal, phone killed in the
   * background, network switch) can stay true for a long time with no one
   * actually listening on the other end. Set true on every "hello" and on
   * every "pong" this socket sends back; flipped false right before each
   * ping goes out. The heartbeat interval below terminates any connection
   * that's still false when its next ping would go out — i.e. it missed a
   * full cycle. This is what makes "existing.ws.readyState === OPEN" in the
   * hello handler's ownership check below actually mean "someone is still
   * there", not just "the OS hasn't noticed yet".
   */
  isAlive: boolean
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
    countryCode: state.countryCode,
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
  const [friends, requestsReceived, requestsSent, blocked, unreadCounts] = await Promise.all([
    listFriends(state.userId),
    listPendingRequestsReceived(state.userId),
    listPendingRequestsSent(state.userId),
    listBlockedByUserWithUsernames(state.userId),
    countUnreadFriendMessages(state.userId),
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
      profilePhoto: f.profilePhoto,
      online: connections.has(f.userId),
      since: f.since,
      unreadCount: unreadCounts.get(f.friendshipId) ?? 0,
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
 * Pushes a fresh friends-snapshot to every currently-online friend of
 * `userId` — the friends-list/chat-header equivalent of "peer-updated"
 * (see the "profile-update" case below, which does the same thing for
 * whoever this account is CURRENTLY matched with). Called only when a
 * "profile-update" actually changed the username or photo, since
 * `listFriends()` re-joins live against `users` either way — a friend
 * who's offline right now just sees the change the next time they connect
 * (sendFriendsSnapshot already runs on every "hello"), same as any other
 * friends-snapshot refresh; this is what gets it there sooner for whoever
 * already has the app open.
 */
async function notifyFriendsOfProfileChange(userId: string) {
  const friends = await listFriends(userId)
  await Promise.all(friends.map((f) => refreshSnapshotIfOnline(f.userId)))
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
  if (state.roomId) return
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
  aState.seeking = false
  bState.seeking = false

  dispatchMatch(aState, bState, room.id, "random", alreadyFriends)
  console.log("ws-server: matched sent to A", { roomId: room.id, displayId: aState.displayId })
  console.log("ws-server: matched sent to B", { roomId: room.id, displayId: bState.displayId })

  // Recorded ONLY now — after both "matched" sends, both to sockets this
  // function itself just confirmed were OPEN with no async gap in between
  // (see the class doc comment on why that ordering is the entire point).
  matchmaker.commitMatch(room.id)
}

type RoomEndReason = "user_skip" | "user_leave" | "blocked" | "socket_closed" | "account_changed" | "socket_replaced" | "setup_timeout"

/**
 * ROOM-ESTABLISHMENT HANDSHAKE.
 *
 * The production bug this closes: "matched" used to be dispatched to both
 * sides the instant a room was created, with nothing whatsoever confirming
 * either browser actually went on to build a working RTCPeerConnection —
 * only that its WebSocket was OPEN (and, for a direct call,
 * `availableForInvitation`'s pre-existing checks). A friend accepting an
 * invite while the SENDER's tab was stale, backgrounded, or otherwise slow
 * to resume JS execution would get "matched" fine, but that sender might
 * never actually create its (initiator-side) RTCPeerConnection or send an
 * SDP offer for an arbitrarily long time — or ever. The recipient, a
 * correctly-behaving non-initiator, has nothing to react to: no offer ever
 * arrives, useWebRTC's OWN recovery logic never engages (it's gated on
 * `connectionState === "connected"`, which never happens without ICE ever
 * starting), and the UI is stuck on "Connecting" forever with no path out.
 *
 * The fix makes a room a REAL call only once both live clients have
 * explicitly told the server their own RTC side is genuinely initialized
 * for this exact room ("rtc-ready" — see its own doc comment in
 * lib/signaling/protocol.ts for exactly what that proves). Only once BOTH
 * have arrives does the server tell the designated initiator to actually
 * start negotiation ("rtc-start") — before that, the initiator does NOT
 * create or send an offer merely because `matched` said `initiator: true`.
 * This structurally guarantees the non-initiator already has its own
 * RTCPeerConnection + signal listener installed before an offer can even
 * exist, which is what makes "the offer arrives and there's nobody around
 * to receive it" impossible by construction, not by luck of timing.
 *
 * A bounded deadline (`roomSetupTestConfig.deadlineMs`) is the safety net
 * around that handshake, NOT the primary mechanism — a room whose initial
 * offer hasn't been relayed within it (whichever side never got that far:
 * never became rtc-ready, or became rtc-ready but the initiator's own
 * offer never actually made it out) is torn down authoritatively and both
 * still-current sides are told via "room-setup-failed", so neither UI can
 * ever be stuck on "Connecting" indefinitely. Cleared the moment the FIRST
 * real offer for a room is observed being relayed (see the "signal" case
 * below) — everything after that (ICE, media, recovery) is useWebRTC's own
 * existing, unrelated responsibility; this deadline is only ever about the
 * initial handshake.
 *
 * Applies identically to random matches and direct/friend calls — `source`
 * is carried through purely for client-side UI/intent decisions (see
 * "matched"'s own doc comment), never to change how this handshake itself
 * behaves.
 */
type RoomSetup = {
  roomId: string
  aUserId: string
  bUserId: string
  /** Whichever side got `initiator: true` in "matched" — always `aUserId` at both call sites below, kept as its own field rather than assumed so this type doesn't quietly depend on that convention holding elsewhere. */
  initiatorUserId: string
  source: "random" | "friend"
  aReady: boolean
  bReady: boolean
  startSent: boolean
  offerRelayed: boolean
  answerRelayed: boolean
  deadline: ReturnType<typeof setTimeout>
}
const roomSetups = new Map<string, RoomSetup>()

/**
 * Test-overridable — see tests/directCall.test.mts, which shortens this
 * dramatically (milliseconds, not seconds) to exercise the deadline
 * without a real multi-second wait per test. A mutable config OBJECT
 * (never a re-exported `let` binding, which ESM makes read-only from an
 * importer) — the same pattern tests/helpers/dbMock.mts already
 * established for `blockCheckDelayMs`/`friendsCheckDelayMs`.
 */
export const roomSetupTestConfig = { deadlineMs: 9_000 }

function clearRoomSetup(roomId: string) {
  const setup = roomSetups.get(roomId)
  if (!setup) return
  clearTimeout(setup.deadline)
  roomSetups.delete(roomId)
}

/** Authoritatively tears down a room whose RTC setup never completed within the deadline — see the class doc comment above for the full design. Safe to call even if the room (or either side's membership in it) has already moved on for any other reason; touches nothing that isn't still genuinely this exact room. */
function abortRoomSetup(roomId: string) {
  const setup = roomSetups.get(roomId)
  if (!setup) return
  clearRoomSetup(roomId)
  matchmaker.destroyRoom(roomId)
  console.warn("rtc: setup timeout", {
    roomId,
    source: setup.source,
    aReady: setup.aReady,
    bReady: setup.bReady,
    offerRelayed: setup.offerRelayed,
  })
  if (setup.source === "friend") console.log("direct-call: room aborted", { roomId })
  for (const userId of [setup.aUserId, setup.bUserId]) {
    const s = connections.get(userId)
    if (s && s.roomId === roomId) {
      s.roomId = null
      send(s.ws, { type: "room-setup-failed", roomId, source: setup.source })
    }
  }
}

/**
 * The ONE place a room is ever dispatched to both sides — used by both
 * random matches (tryMatch, below) and direct/friend calls
 * ("match-invite-respond"), so the handshake this file's own doc comment
 * describes applies identically to both, never duplicated or able to drift
 * apart between the two call sites. `aState` is always the designated
 * initiator. Registers this room's RoomSetup entry (see its own doc
 * comment) and starts its bounded setup deadline BEFORE either "matched"
 * send, so there is no gap in which a room exists with no deadline
 * protecting it.
 */
function dispatchMatch(
  aState: ConnectionState,
  bState: ConnectionState,
  roomId: string,
  source: "random" | "friend",
  alreadyFriends: boolean
) {
  aState.roomId = roomId
  bState.roomId = roomId
  const deadline = setTimeout(() => abortRoomSetup(roomId), roomSetupTestConfig.deadlineMs)
  deadline.unref()
  roomSetups.set(roomId, {
    roomId,
    aUserId: aState.userId,
    bUserId: bState.userId,
    initiatorUserId: aState.userId,
    source,
    aReady: false,
    bReady: false,
    startSent: false,
    offerRelayed: false,
    answerRelayed: false,
    deadline,
  })
  console.log(source === "friend" ? "direct-call: room created" : "rtc: room created", { roomId, source })
  send(aState.ws, { type: "matched", roomId, initiator: true, peer: toPublicIdentity(bState), alreadyFriends, source })
  send(bState.ws, { type: "matched", roomId, initiator: false, peer: toPublicIdentity(aState), alreadyFriends, source })
}

function leaveCurrentRoom(state: ConnectionState, notifyPartner: boolean, reason: RoomEndReason) {
  if (!state.roomId) return
  const roomId = state.roomId
  console.info("ws-server: room destroyed", { roomId, reason })
  clearRoomSetup(roomId)
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
function cleanUpAccount(oldState: ConnectionState, reason: RoomEndReason, preserveInvitations = false) {
  const wasCurrent = connections.get(oldState.userId) === oldState
  if (!wasCurrent) {
    console.log("ws-server: cleanup skipped — this state was already superseded", { displayId: oldState.displayId })
    return
  }
  leaveCurrentRoom(oldState, true, reason)
  if (!preserveInvitations) cancelInvitations(oldState)
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
    // Keeps `state.isAlive` honest for the heartbeat below — registered
    // once per physical connection (not per-hello) since `state` itself
    // may be reassigned (an account switch, a re-hello) without this
    // socket ever actually closing; reading the outer `let state` here
    // always sees whichever ConnectionState currently owns it.
    ws.on("pong", () => {
      if (state) state.isAlive = true
    })
    // A connection that never completes "hello" (a stray/misbehaving
    // client, a probe, or one whose hello genuinely never arrives) is
    // never added to `connections` — the heartbeat above only ever
    // iterates that map, so a not-yet-authenticated socket is otherwise
    // invisible to it and would sit open indefinitely with nothing to
    // reap it. This is the pre-hello equivalent of the heartbeat, closed
    // the moment "hello" actually succeeds below.
    const HELLO_TIMEOUT_MS = 15_000
    const helloTimeout = setTimeout(() => {
      if (!state) {
        console.log("ws-server: closing connection — no 'hello' received in time")
        ws.close(1008, "hello timeout")
      }
    }, HELLO_TIMEOUT_MS)
    ws.on("close", () => clearTimeout(helloTimeout))
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
        // Retries/resumes are not skips. Never let a delayed find command
        // abandon an established room (including a direct friend call).
        if (message.type === "find" && state.roomId) {
          console.debug("ws-server: find ignored", { roomId: state.roomId, reason: "already_matched" })
          return
        }
        if (message.type === "find" || message.type === "skip") {
          cancelInvitations(state)
          state.seeking = true
          state.searchGeneration += 1
          capturedGeneration = state.searchGeneration
        } else if (message.type === "leave") {
          cancelInvitations(state)
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
          if (message.type === "match-invite" || message.type === "match-invite-respond") {
            send(ws, { type: "match-invite-error", message: "Couldn't process the invitation. Please try again." })
          }
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
          cleanUpAccount(state, "account_changed")
        }

        // Also re-sent whenever the user reconnects the same account —
        // preserve any room they're currently in rather than assuming this
        // is a fresh reconnect with nothing left to carry forward.
        let existing = connections.get(userId)
        // Pending invitations are rebound to the authenticated replacement
        // below, rather than canceled by a routine repeat handshake.
        // A second "hello" for the same account on a *different* socket
        // used to ALWAYS mean the old one was superseded — close it,
        // destroy whatever room/search it had, let the new one take over.
        // That was correct for a genuine reconnect (the old socket really
        // is dead), but wrong for a duplicate tab/device opened WHILE the
        // old one is still healthy: it let any second tab silently steal
        // ownership and tear down an active call out from under the first
        // one, and — because the displaced client then auto-reconnected —
        // produced an infinite replace/reconnect fight between the two.
        //
        // OWNERSHIP POLICY: the existing connection only keeps ownership
        // while it's actually doing something a duplicate could destroy —
        // an active room, or a live search (`seeking`) that a takeover
        // would silently abandon mid-attempt. An existing connection just
        // sitting idle (home screen, browsing friends, freshly signed in —
        // nothing exclusive in progress) has nothing worth protecting, so
        // a second device's hello is free to take over exactly like a
        // normal reconnect. Without this narrowing, a healthy-but-idle
        // connection on one device (e.g. a laptop tab left open) silently
        // locked out every other device on the same account — a phone
        // opening the app would get rejected and never see live data (a
        // newly added friend, an updated unread count, ...) until that
        // other tab actually closed.
        //
        // `isAlive` (driven by the heartbeat below) is what keeps
        // `readyState === OPEN` honest — a truly-vanished client can still
        // show OPEN for a long time otherwise.
        if (existing && existing.ws !== ws) {
          const existingIsExclusive = Boolean(existing.roomId) || existing.seeking
          if (existing.ws.readyState === WebSocket.OPEN && existing.isAlive && existingIsExclusive) {
            console.log("ws-server: hello rejected — account already has a healthy connection in a room/search", {
              existingDisplayId: existing.displayId,
            })
            send(ws, { type: "superseded" })
            ws.close(WS_CLOSE_SUPERSEDED, "superseded")
            return
          }
          // The previous connection for this account is dead or not
          // responding to heartbeats — a legitimate reconnect (real
          // network drop, refresh, etc.), not a live duplicate. A new
          // transport has no surviving WebRTC session either way, so
          // retire the old room before any async profile reads, not in
          // its own delayed close callback (which races with registering
          // this connection).
          cleanUpAccount(existing, "socket_replaced", true)
          existing.ws.close()
          existing = undefined
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
        let gender = (await getAccountGender(userId)) ?? undefined
        if (!gender && isValidGender(message.gender)) {
          await claimAccountGender(userId, message.gender)
          gender = (await getAccountGender(userId)) ?? undefined
        }

        state = {
          ws,
          userId,
          displayId: existing?.displayId ?? randomUUID(),
          handle,
          username,
          gender,
          profilePhoto: (await getPublicProfile(userId)).profilePhoto,
          countryCode: verified.countryCode,
          roomId: existing?.roomId ?? null,
          seeking: existing?.seeking ?? false,
          searchGeneration: existing?.searchGeneration ?? 0,
          profileRevision: 0,
          isAlive: true,
        }
        connections.set(userId, state)
        connectionsByDisplayId.set(state.displayId, userId)
        let restoredInvitation = false
        for (const invite of friendInvitations.values()) {
          if (invite.sender.userId === userId) { invite.sender = state; restoredInvitation = true }
          if (invite.recipient.userId === userId) { invite.recipient = state; restoredInvitation = true }
        }
        if (restoredInvitation) publishInvitations(state)

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
        case "friends-refresh":
          await trySendFriendsSnapshot(state)
          publishInvitations(state)
          break
        case "find":
        case "skip": {
          if (message.type === "find" && state.roomId) break
          console.log("ws-server: find received", { displayId: state.displayId, type: message.type })
          if (message.type === "skip") leaveCurrentRoom(state, true, "user_skip")
          // capturedGeneration was set synchronously at message-receipt
          // time, above — always defined here (state existed then too,
          // since it still exists now and nothing removes it except a
          // socket close, which would have prevented this handler from
          // running at all).
          await tryMatch(state, capturedGeneration!)
          break
        }
        case "leave": {
          leaveCurrentRoom(state, true, "user_leave")
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
            // Diagnostic-only observation of the room-establishment
            // handshake's actual progress — never gates or delays the
            // relay itself (see the "signal" relay unconditionally below,
            // and SignalBacklog's own doc comment for why early/recovery
            // signals must keep working exactly as before regardless of
            // this handshake's own state). The FIRST offer relayed for a
            // room is what proves the initiator's negotiation genuinely
            // started — that's what actually clears the setup deadline
            // (see abortRoomSetup's own doc comment); the answer is logged
            // purely for the diagnostics this whole investigation needed
            // (Railway previously had no way to tell whether a direct
            // invitation successfully created a room, let alone where RTC
            // setup actually stalled).
            const setup = roomSetups.get(message.roomId)
            if (setup) {
              if (message.data.kind === "offer" && !setup.offerRelayed) {
                setup.offerRelayed = true
                clearTimeout(setup.deadline)
                console.log("rtc: initial offer relayed", { roomId: message.roomId })
              } else if (message.data.kind === "answer" && !setup.answerRelayed) {
                setup.answerRelayed = true
                console.log("rtc: initial answer relayed", { roomId: message.roomId })
              }
            }
            send(partner.ws, { type: "signal", roomId: message.roomId, data: message.data })
          }
          break
        }
        case "rtc-ready": {
          if (typeof message.roomId !== "string" || state.roomId !== message.roomId) break
          const setup = roomSetups.get(message.roomId)
          // No setup entry: either this room was never dispatched through
          // dispatchMatch() (shouldn't happen — every "matched" now goes
          // through it) or the handshake already resolved one way or the
          // other (rtc-start already sent and the deadline cleared, or the
          // room was already aborted) — either way, a late/duplicate
          // "rtc-ready" here is a safe no-op, never an error.
          if (!setup) break
          if (state.userId === setup.aUserId) {
            if (setup.aReady) break // idempotent — a duplicate must never re-trigger rtc-start
            setup.aReady = true
            console.log("rtc: side A ready", { roomId: message.roomId })
          } else if (state.userId === setup.bUserId) {
            if (setup.bReady) break
            setup.bReady = true
            console.log("rtc: side B ready", { roomId: message.roomId })
          } else {
            break // not actually a participant in this exact room
          }
          if (setup.aReady && setup.bReady && !setup.startSent) {
            setup.startSent = true
            const initiatorState = connections.get(setup.initiatorUserId)
            if (initiatorState && initiatorState.roomId === message.roomId) {
              console.log("rtc: both ready — starting initiator", { roomId: message.roomId })
              send(initiatorState.ws, { type: "rtc-start", roomId: message.roomId })
            } else {
              // The designated initiator vanished between becoming ready
              // and now — both sides being ready moments ago makes this
              // rare, but if it happens there's no one left to actually
              // start negotiation. The setup deadline (still armed —
              // nothing here clears it) is what bounds this rather than
              // leaving the other side waiting on a "rtc-start" that will
              // never come.
              console.warn("rtc: initiator missing at start time — leaving the setup deadline to abort", { roomId: message.roomId })
            }
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
          console.debug("match-chat: send requested", { roomId: message.roomId })
          // Authoritative staleness check — covers all three ways this can
          // be stale at once: this account has no room at all, the
          // supplied roomId doesn't match its actual live one (roomPartner
          // derives the partner from `state.roomId`, never `message.roomId`
          // — see its own doc comment), or the partner has already left
          // (roomPartner returns undefined, or their own roomId has since
          // moved on). Previously this silently discarded the message here
          // with no ack at all — the sender's own optimistic local append
          // (now removed, see chat-sent below) meant they saw "sent" for a
          // message that never reached anyone. An explicit "chat-failed"
          // is what fixes that.
          const partner = roomPartner(state)
          if (!partner || partner.roomId !== message.roomId) {
            console.debug("match-chat: rejected stale room", { roomId: message.roomId })
            send(state.ws, { type: "chat-failed", roomId: message.roomId, clientMessageId: message.clientMessageId, reason: "stale_room" })
            break
          }

          const content = message.content
          if (content.kind === "text") {
            const text = sanitizeText(content.text, 500)
            if (!text || containsBlockedChatContent(text)) {
              send(state.ws, { type: "chat-failed", roomId: message.roomId, clientMessageId: message.clientMessageId, reason: "blocked" })
              break
            }
            const ts = Date.now()
            send(partner.ws, {
              type: "chat",
              roomId: message.roomId,
              from: "peer",
              content: { kind: "text", text },
              ts,
            })
            send(state.ws, { type: "chat-sent", roomId: message.roomId, clientMessageId: message.clientMessageId, ts })
            console.debug("match-chat: delivered", { roomId: message.roomId })
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
              const ts = Date.now()
              send(partner.ws, {
                type: "chat",
                roomId: message.roomId,
                from: "peer",
                content: { kind: "image", dataUrl: content.dataUrl },
                ts,
              })
              send(state.ws, { type: "chat-sent", roomId: message.roomId, clientMessageId: message.clientMessageId, ts })
              console.debug("match-chat: delivered", { roomId: message.roomId })
            } else {
              send(state.ws, { type: "chat-failed", roomId: message.roomId, clientMessageId: message.clientMessageId, reason: "blocked" })
            }
          } else {
            send(state.ws, { type: "chat-failed", roomId: message.roomId, clientMessageId: message.clientMessageId, reason: "invalid" })
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
            leaveCurrentRoom(state, true, "blocked")
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

          const previousUsername = state.username
          const previousProfilePhoto = state.profilePhoto

          const rawUsername = sanitizeText(message.username, MAX_USERNAME_LENGTH)
          const nextUsername = rawUsername && !containsSevereContent(rawUsername) ? rawUsername : state.username
          if (isValidGender(message.gender) && message.gender !== state.gender) await claimAccountGender(state.userId, message.gender)
          const nextGender = (await getAccountGender(state.userId)) ?? state.gender
          const genderChanged = nextGender !== state.gender

          state.username = nextUsername
          state.gender = nextGender
          if (message.profilePhoto !== undefined) state.profilePhoto = (await getPublicProfile(state.userId)).profilePhoto

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

          // FRIENDS: a username/photo change is worth telling online
          // friends about regardless of whether this account is currently
          // in a room, searching, or paused — unlike the gender-driven
          // requeue above, this isn't about matching at all, just keeping
          // an already-open Friends list/chat header current. See
          // notifyFriendsOfProfileChange's own doc comment.
          if (nextUsername !== previousUsername || (message.profilePhoto !== undefined && message.profilePhoto !== previousProfilePhoto)) {
            const { userId, displayId } = state
            notifyFriendsOfProfileChange(userId).catch((err) =>
              console.error("ws-server: notifying friends of a profile change failed", { displayId, ...describeErr(err) })
            )
          }
          break
        }
        case "match-invite": {
          const fail = () => send(state!.ws, { type: "match-invite-error", message: "Invite unavailable. Both friends must be online and not matching or in a call." })
          if (typeof message.targetUserId !== "string" || message.targetUserId.length > 200) { fail(); break }
          const target = connections.get(message.targetUserId)
          if (!target || target === state || !availableForInvitation(state) || !availableForInvitation(target)) { fail(); break }
          const generation = state.searchGeneration
          const targetGeneration = target.searchGeneration
          const allowed = await friendsMayCall(state, target)
          if (!allowed || !availableForInvitation(state) || !availableForInvitation(target) || state.searchGeneration !== generation || target.searchGeneration !== targetGeneration) { fail(); break }
          // One pending invitation per sender, and no duplicate/crossed pair.
          if ([...friendInvitations.values()].some((invite) => invite.sender === state || (invite.sender === target && invite.recipient === state))) {
            send(state.ws, { type: "match-invite-error", message: "You already have a pending invitation. Check Requests or wait for it to expire." })
            break
          }
          const id = randomUUID()
          const timer = setTimeout(() => { const invite = friendInvitations.get(id); if (invite) removeInvitation(invite) }, 60_000)
          timer.unref()
          friendInvitations.set(id, { id, sender: state, recipient: target, expiresAt: Date.now() + 60_000, timer })
          publishInvitations(state)
          publishInvitations(target)
          break
        }
        case "match-invite-respond": {
          if (typeof message.invitationId !== "string" || typeof message.accept !== "boolean") break
          const invite = friendInvitations.get(message.invitationId)
          if (!invite || invite.recipient !== state) {
            send(state.ws, { type: "match-invite-error", message: "That invitation is no longer available." })
            break
          }
          if (!message.accept) { removeInvitation(invite); break }
          const sender = invite.sender
          if (!availableForInvitation(sender)) {
            send(state.ws, { type: "match-invite-error", message: "Your friend is reconnecting or busy. Try again when they’re available." })
            break
          }
          const senderGeneration = sender.searchGeneration
          const recipientGeneration = state.searchGeneration
          const allowed = await friendsMayCall(sender, state)
          // Everything the class doc comment on the room-establishment
          // handshake (above leaveCurrentRoom) lists as needing a re-check
          // right before commit: the invitation itself (still pending, not
          // expired, still genuinely from `sender`), both sides still
          // eligible (availableForInvitation — includes heartbeat
          // liveness, no room, not seeking), neither side's search intent
          // having moved on (generation match), AND — the one this used to
          // be missing — that `connections.get(...)` for BOTH userIds
          // still resolves to these EXACT captured ConnectionState object
          // references, not a replacement (a reconnect/account-switch that
          // created a NEW ConnectionState for the same userId — see
          // cleanUpAccount, which always bumps the OLD object's own
          // searchGeneration too, so this is genuine defense-in-depth on
          // top of the generation check, not the only thing catching it).
          if (
            friendInvitations.get(invite.id) !== invite ||
            invite.expiresAt <= Date.now() ||
            !allowed ||
            invite.sender !== sender ||
            !availableForInvitation(sender) ||
            !availableForInvitation(state) ||
            senderGeneration !== sender.searchGeneration ||
            recipientGeneration !== state.searchGeneration ||
            connections.get(sender.userId) !== sender ||
            connections.get(state.userId) !== state
          ) {
            removeInvitation(invite)
            send(state.ws, { type: "match-invite-error", message: "This friend is no longer available. Please send a new invitation." })
            break
          }
          const room = matchmaker.createDirectRoom(sender.userId, state.userId, senderGeneration, recipientGeneration)
          if (!room) { removeInvitation(invite); break }
          cancelInvitations(sender)
          cancelInvitations(state)
          console.log("direct-call: invite accepted", { roomId: room.id })
          // `sender` is always the room-establishment handshake's
          // designated initiator — see dispatchMatch's own doc comment.
          // Media readiness (a live local video track, not just "the
          // camera permission exists") is verified client-side before
          // either side's own "rtc-ready" — see that message's doc
          // comment in lib/signaling/protocol.ts — not re-checked here;
          // the server has no visibility into the browser's actual
          // MediaStreamTrack state, only into the handshake built on top
          // of it.
          dispatchMatch(sender, state, room.id, "friend", true)
          matchmaker.commitMatch(room.id)
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
        case "user-report": {
          if (message.targetUserId && message.targetUserId !== state.userId) {
            await fileReport({
              reporterId: state.userId,
              reportedId: message.targetUserId,
              category: message.category,
              details: sanitizeText(message.details, MAX_REPORT_DETAILS_LENGTH) || undefined,
            })
          }
          send(state.ws, { type: "user-reported" })
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
        case "friend-chat-send": {
          console.debug("friend-chat: send requested", { displayId: state.displayId })
          const text = sanitizeText(message.text, 500)
          if (!text || containsBlockedChatContent(text)) {
            send(state.ws, {
              type: "friend-chat-error",
              friendshipId: message.friendshipId,
              clientMessageId: message.clientMessageId,
              reason: "invalid",
            })
            break
          }
          let result
          try {
            result = await sendFriendMessage(state.userId, message.friendshipId, message.clientMessageId, text, message.replyToId)
          } catch (err) {
            console.error("ws-server: friend-chat-send failed", { displayId: state.displayId, ...describeErr(err) })
            send(state.ws, {
              type: "friend-chat-error",
              friendshipId: message.friendshipId,
              clientMessageId: message.clientMessageId,
              reason: "invalid",
            })
            break
          }
          if (result.status !== "sent") {
            // "not_friends" (removed/never existed) or "blocked" (either
            // side blocked the other) — see lib/db.ts's sendFriendMessage(),
            // the one authoritative check; nothing here trusts the client's
            // own idea of who it's friends with.
            send(state.ws, {
              type: "friend-chat-error",
              friendshipId: message.friendshipId,
              clientMessageId: message.clientMessageId,
              reason: result.status,
            })
            break
          }
          console.debug("friend-chat: persisted", { friendshipId: message.friendshipId, duplicate: result.duplicate })
          send(state.ws, {
            type: "friend-chat-sent",
            friendshipId: message.friendshipId,
            clientMessageId: message.clientMessageId,
            messageId: result.message.id,
            createdAt: result.message.createdAt,
          })
          // A retried send (the client's own clientMessageId dedup) is
          // already persisted from its first attempt — the recipient
          // already got (or will get, from that first attempt) the live
          // push; sending it again here would show the same message twice.
          if (result.duplicate) break
          const recipient = connections.get(result.recipientId)
          if (recipient) {
            send(recipient.ws, {
              type: "friend-chat-message",
              friendshipId: message.friendshipId,
              message: { id: result.message.id, text: result.message.text, createdAt: result.message.createdAt, replyToId: result.message.replyToId },
            })
            console.debug("friend-chat: live delivery", { friendshipId: message.friendshipId })
            // Keeps the recipient's own unread badge correct the instant
            // the message arrives, not just on their next hello.
            await trySendFriendsSnapshot(recipient)
          } else {
            console.debug("friend-chat: recipient offline", { friendshipId: message.friendshipId })
          }
          break
        }
        case "friend-chat-read": {
          const result = await markFriendMessagesRead(state.userId, message.friendshipId)
          console.debug("friend-chat: marked read", { displayId: state.displayId, result: result.status, updated: result.status === "ok" ? result.updated : undefined })
          if (result.status !== "ok") break
          await trySendFriendsSnapshot(state)
          // Tell the sender their messages were just read — but only when
          // something actually flipped (a no-op reopen must never re-notify
          // the other side with a fresh "just read" moment for messages
          // they'd already seen read).
          if (result.updated > 0) {
            const sender = connections.get(result.otherUserId)
            if (sender) {
              send(sender.ws, { type: "friend-chat-read-receipt", friendshipId: message.friendshipId, readAt: result.readAt })
            }
          }
          break
        }
        case "friend-typing": {
          // Re-derives the other side the same authoritative way
          // "friend-chat-send" does — the client's own idea of who it's
          // friends with is never trusted, and a removed/blocked
          // relationship must never leak a live typing signal either.
          const otherId = await getFriendshipOtherUser(state.userId, message.friendshipId)
          if (!otherId) break
          const peerConn = connections.get(otherId)
          if (peerConn) send(peerConn.ws, { type: "friend-typing", friendshipId: message.friendshipId })
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
      // Keep the short-lived invitation until its original expiry so a
      // transient socket loss does not erase it from the friend's Requests.
      cleanUpAccount(state, "socket_closed", true)
    })
  })

  // Heartbeat: the only thing that makes `existing.isAlive` in the hello
  // handler's ownership check (above) mean anything beyond "the OS hasn't
  // noticed the TCP connection is gone yet" — a client that vanished
  // without a clean close (lost signal, backgrounded and killed, network
  // switch) can otherwise leave `readyState === OPEN` for a long time with
  // nothing actually listening, which would make a genuine reconnect
  // attempt for that account keep losing the ownership race forever.
  // Standard `ws`-library ping/pong pattern: every cycle, anything that
  // didn't answer the *previous* ping is terminated (its own "close"
  // handler above runs cleanUpAccount normally); everything else is
  // marked not-yet-answered and pinged again. `unref()` so this interval
  // alone never keeps the process alive past `server.ts`'s own shutdown.
  const HEARTBEAT_INTERVAL_MS = 20_000
  const heartbeatTimer = setInterval(() => {
    for (const connectionState of connections.values()) {
      if (connectionState.ws.readyState !== WebSocket.OPEN) continue // its own close handler already cleans it up
      if (!connectionState.isAlive) {
        console.log("ws-server: heartbeat missed — terminating unresponsive connection", { displayId: connectionState.displayId })
        connectionState.ws.terminate()
        continue
      }
      connectionState.isAlive = false
      connectionState.ws.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref()

  return wss
}
