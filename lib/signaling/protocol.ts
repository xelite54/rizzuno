/**
 * Wire protocol between the browser and the realtime server (server.ts).
 * Pure types + one const — safe to import from client code or the
 * standalone Node server alike.
 */

export type Gender = "male" | "female"

/** Runtime guard for a value that's typed as `Gender` but arrived over the wire (client-supplied `ClientMessage` fields are only ever TypeScript types at runtime — nothing actually enforces them) — used wherever a client-declared gender is about to affect matching, so a malformed/tampered value can't slip past the opposite-gender-only rule as some third, unhandled case. */
export function isValidGender(value: unknown): value is Gender {
  return value === "male" || value === "female"
}

export type PeerIdentity = {
  /** The Google account's own stable id, verified server-side from a signed ticket (see lib/realtimeTicket.ts) — never a bare client-supplied value. Not shown to the peer (see PublicPeerIdentity below); used internally for matching/blocks/reports. */
  userId: string
  /** A cosmetic fallback display name (e.g. "Velvet Maple"), minted client-side — shown only until a real username is chosen. Carries no identity/security meaning. */
  handle: string
  /** The guest's own chosen username, if they've set one — carried through "hello" and "matched" so a real match can see it. */
  username?: string
  /** The guest's own chosen gender, if they've set one — the matchmaker only ever pairs opposite genders, so this has to reach the server, not just the peer. */
  gender?: Gender
  /** The guest's own chosen profile photo, if they've set one — carried through "hello"/"matched"/"peer-updated" the same as username, so a live match actually sees it (and sees it update if changed mid-call), not just an initial letter. */
  profilePhoto?: string | null
}

/**
 * What a peer is actually shown about the other person — `userId` (Google's
 * stable account id) is deliberately never included. `displayId` is a
 * random, per-connection token with no relationship to the real account —
 * just something stable enough for the UI to key React lists / detect "did
 * the peer change" with, not an identity a peer could use to look anyone up
 * or target them outside the current call. Block/report never rely on it
 * either — see server/ws-server.ts, which resolves "who's in my room right
 * now" from its own server-side room state, not from a client-supplied id.
 *
 * Sending a friend request also goes through `displayId`, not a
 * client-known real id (see "friend-request" below) — the server is the
 * only thing that ever resolves a displayId to the real account behind it,
 * exactly like block/report already do for room membership.
 */
export type PublicPeerIdentity = Omit<PeerIdentity, "userId"> & { displayId: string; countryCode?: string }

/** Mirrors the browser's RTCIceCandidateInit shape without depending on DOM lib types. */
export type IceCandidateInit = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

/**
 * A room has exactly one RTCPeerConnection per side, for its entire
 * lifetime (see hooks/useWebRTC.ts) — there is no fresh-RTCPeerConnection
 * recovery tier to disambiguate signals against, so unlike an earlier
 * version of this type, none of these carry a negotiation/generation id.
 * A signal that reaches a room's signal listener at all is already known
 * to belong to that room's one negotiation; room-level staleness (a signal
 * for a room that's already ended) is handled upstream, by
 * useMatchmaking.ts's own per-room signal routing, before any of these are
 * ever delivered.
 */
export type RtcSignal =
  | { kind: "ice-restart-request" }
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: IceCandidateInit }

export type ReportCategory =
  | "sexual_content"
  | "harassment"
  | "hate"
  | "scam"
  | "spam"
  | "underage_concern"
  | "violence"
  | "other"

/** A chat message body — text, or an image sent as a resized data URL. */
export type ChatContent = { kind: "text"; text: string } | { kind: "image"; dataUrl: string }

// Resized client-side before sending (see lib/image.ts); this is just a
// server-side backstop against an oversized payload getting through.
export const MAX_CHAT_IMAGE_LENGTH = 2_000_000

/**
 * A confirmed friend — unlike PublicPeerIdentity, this one *does* carry the
 * real account id. That's a deliberate, narrow exception: it's only ever
 * sent for a relationship both accounts explicitly agreed to (a mutually
 * accepted friend request), never for an ordinary match, so it doesn't
 * expose anyone's identity involuntarily the way including it in
 * PublicPeerIdentity would.
 */
export type FriendSummary = {
  id: string
  userId: string
  username: string | null
  /** The friend's current profile photo — re-sent fresh in every friends-snapshot (see server/ws-server.ts's sendFriendsSnapshot/notifyFriendsOfProfileChange), so a friend's own later photo/username change is reflected the next time this account receives one, not frozen at whatever it was when the friendship formed. */
  profilePhoto: string | null
  online: boolean
  since: number
  /** How many of this friend's messages are currently unread — real, server-computed state (see lib/db.ts's countUnreadFriendMessages()), not a client-local counter. Refreshed via a fresh friends-snapshot on every hello, right after a live "friend-chat-message" delivery, and after this account sends "friend-chat-read" — so a refresh/relogin always shows the correct count, never a stale or purely-local one. */
  unreadCount: number
}

/** One friend-chat message, as delivered/echoed over the realtime socket or returned by GET /api/friends/messages/[friendshipId] — text only, matching the existing UI (see AGENTS: "Only implement the text-chat functionality that currently exists"). Never carries sender/recipient account ids itself; the surrounding context (which friendship, "friend-chat-message" vs the sender's own optimistic copy) is what tells the two apart client-side. */
export type FriendChatMessage = { id: string; text: string; createdAt: number }

/** A friend request someone else sent you — `id` is the request's own opaque id (used to accept/decline it), not the sender's account id, which this doesn't expose until you accept. */
export type ReceivedFriendRequest = { id: string; senderId: string; username: string | null; createdAt: number }

/** A friend request you sent — `recipientId` is included because, unlike an incoming request, you already necessarily learned it by choosing to send this (it's your own action, not exposure of a stranger's identity). */
export type SentFriendRequest = { id: string; recipientId: string; createdAt: number }

export type BlockedUserSummary = { userId: string; username: string | null }

export type MatchInvitation = { id: string; userId: string; username: string; expiresAt: number; direction: "incoming" | "outgoing" }

export type FriendRequestResult =
  | "subscription_required"
  | "sent"
  | "auto_accepted"
  | "already_friends"
  | "already_requested"
  | "blocked"
  | "peer_offline"

export type ClientMessage =
  | { type: "friends-refresh" }
  | { type: "match-invite"; targetUserId: string }
  | { type: "match-invite-respond"; invitationId: string; accept: boolean }
  | {
      type: "hello"
      /** Minted by app/api/realtime/ticket — proves who this connection is on behalf of. The server verifies it and derives userId itself; nothing here is trusted at face value (see server/ws-server.ts). */
      ticket: string
      handle: string
      /** The one-time baseline identity snapshot for this connection/auth generation — everything after "ready" that changes this goes through "profile-update" instead (see below), never a repeat "hello". */
      username?: string
      gender?: Gender
      profilePhoto?: string | null
    }
  | { type: "find" }
  | { type: "skip" }
  | { type: "leave" }
  | { type: "signal"; roomId: string; data: RtcSignal }
  /**
   * "My WebRTC side for this room is genuinely initialized" — sent by
   * useMatchmaking.ts only once ALL of: `roomId` is current, useWebRTC has
   * created the RTCPeerConnection (video/audio transceivers included), its
   * signal listener for this exact room is registered, and (see
   * useMatchmaking.ts's own doc comment) local video is a live track. The
   * server tracks this independently for both sides of a room and only
   * dispatches "rtc-start" (below) to the designated initiator once BOTH
   * have sent it — see server/ws-server.ts's room-establishment handshake
   * for the full design and why "matched" alone was never enough (a stale/
   * backgrounded browser could receive "matched" and never actually get
   * this far, leaving its partner's UI on "Connecting" forever with no
   * offer ever coming).
   */
  | { type: "rtc-ready"; roomId: string }
  /** `clientMessageId` is what "chat-sent"/"chat-failed" below echo back so the sender can reconcile its own optimistic copy — see hooks/useMatchmaking.ts's sendChat(), which never marks a message actually sent until one of those two arrives. */
  | { type: "chat"; roomId: string; clientMessageId: string; content: ChatContent }
  | { type: "report"; roomId: string; category: ReportCategory; details?: string }
  | { type: "block"; roomId: string }
  /** Reverses a block this account previously placed — never the other direction (see lib/db.ts's removeBlock). `targetUserId` is one the client only ever learned from its own blocked-users snapshot, not a value it's guessing. */
  | { type: "unblock"; targetUserId: string }
  | { type: "mic-state"; roomId: string; micEnabled: boolean }
  | { type: "typing"; roomId: string }
  /**
   * A change to username/gender/profilePhoto made *after* "hello" already
   * established this connection's baseline identity — deliberately a
   * separate message from "hello" (see its own doc comment) so editing a
   * profile mid-session never re-runs ticket verification / account-status
   * checks / friends-snapshot loading, and can't race a concurrent "hello".
   * `revision` must be strictly greater than the last one this connection
   * applied (starting from the hello snapshot, which counts as revision 0)
   * — the server drops anything not strictly increasing (see
   * server/ws-server.ts), so several rapid edits always converge on
   * whichever was sent *last*, never whichever network round trip happened
   * to finish last.
   */
  | {
      type: "profile-update"
      revision: number
      username?: string
      gender?: Gender
      profilePhoto?: string | null
    }
  /** Sends a friend request to whoever currently holds this displayId — resolved server-side to a real account (see server/ws-server.ts's connectionsByDisplayId); the client never supplies or learns a target's real id here. */
  | { type: "friend-request"; targetDisplayId: string }
  | { type: "friend-respond"; requestId: string; accept: boolean }
  | { type: "unfriend"; friendshipId: string }
  /** Blocking someone you're already friends with (or have a pending request with) — `targetUserId` is one the client only ever learned from a prior friends-snapshot/request, i.e. a relationship it was already told about, not an arbitrary id it's guessing. */
  | { type: "friend-block"; targetUserId: string }
  /**
   * Sends a friend-chat text message — rides this same authenticated
   * socket (see AGENTS: "DO NOT create a second WebSocket for Friends
   * chat"), never a separate connection. `friendshipId` is never trusted
   * at face value; the server derives the recipient itself via
   * lib/db.ts's getFriendshipOtherUser() and rejects the send outright if
   * the friendship doesn't exist, doesn't belong to this account, or
   * either side has blocked the other. `clientMessageId` is both the
   * dedup key (see migration 0009_friend_messages' UNIQUE constraint) and
   * what "friend-chat-sent"/"friend-chat-error" echo back.
   */
  | { type: "friend-chat-send"; friendshipId: string; clientMessageId: string; text: string }
  /** Marks every message this account has RECEIVED in `friendshipId` as read — sent on opening a conversation, and again for any later message that arrives while it's still open. Never marks this account's own outgoing messages; see lib/db.ts's markFriendMessagesRead(). */
  | { type: "friend-chat-read"; friendshipId: string }

export type ServerMessage =
  | { type: "match-invitations"; invitations: MatchInvitation[] }
  | { type: "match-invite-error"; message: string }
  /**
   * Explicit hello-accepted acknowledgement — sent once, right after a
   * "hello" is verified and this connection's state/friends-snapshot are
   * fully set up server-side. This is what actually means "the server is
   * ready to receive 'find'", as distinct from the WebSocket transport
   * merely being open (see useSignalingSocket's `connected`) or a client
   * merely having *sent* hello. Never inferred from a delay/timeout on the
   * client — see hooks/useMatchmaking.ts's `realtimeReady`.
   */
  | { type: "ready" }
  | { type: "queued" }
  /**
   * `source` is authoritative, server-decided, and drives real
   * client-side behavior (see hooks/useMatchmaking.ts) — never cosmetic:
   * "random" is the only source that implies "keep automatically finding
   * someone if this ends" (a direct/friend call must never accidentally
   * start random matchmaking just because it failed or the friend left —
   * see the room-establishment handshake's own doc comment in
   * server/ws-server.ts for the full reasoning).
   */
  | { type: "matched"; roomId: string; initiator: boolean; peer: PublicPeerIdentity; alreadyFriends: boolean; source: "random" | "friend" }
  /** The current partner edited their own profile mid-call (e.g. set/changed their username) — same shape as "matched"'s peer, just a refresh rather than a new match. */
  | { type: "peer-updated"; roomId: string; peer: PublicPeerIdentity }
  | { type: "signal"; roomId: string; data: RtcSignal }
  /**
   * Sent ONLY to the room's designated initiator, and only once the server
   * has received "rtc-ready" from BOTH sides of this exact room — see
   * "rtc-ready" above for what that actually proves, and
   * server/ws-server.ts's room-establishment handshake for the full
   * design. The initiator must not create/send an SDP offer before this
   * arrives, even though it already knows `initiator: true` from
   * "matched" — that's the entire point: "matched" alone never proved the
   * OTHER side was genuinely ready to receive one.
   */
  | { type: "rtc-start"; roomId: string }
  /**
   * A committed room never finished establishing a real WebRTC session —
   * neither side sent "rtc-ready" (or only one did) within
   * server/ws-server.ts's bounded room-setup deadline, most often because
   * one browser was stale, backgrounded, or otherwise unresponsive right
   * after "matched" (see that file's own doc comment for the production
   * bug this closes). The server has already authoritatively torn the
   * room down by the time this arrives — the client's only job is to
   * clear its own local room/RTC state and, for `source: "friend"`, land
   * back on idle/home rather than reusing "peer-left"'s random-match
   * auto-retry behavior (see "matched"'s own `source` field).
   */
  | { type: "room-setup-failed"; roomId: string; source: "random" | "friend" }
  | { type: "chat"; roomId: string; from: "peer"; content: ChatContent; ts: number }
  /** Delivery acknowledgement for a "chat" send — the ONLY thing that turns the sender's own optimistic message from "sending" into "sent" (see hooks/useMatchmaking.ts's sendChat()). Appending a message locally the instant it's sent, without waiting for this, is exactly the "phantom sent" bug this exists to fix: useSignalingSocket.send() silently drops a message when the transport isn't open, which previously left the sender seeing a message that never reached anyone. */
  | { type: "chat-sent"; roomId: string; clientMessageId: string; ts: number }
  /** A "chat" send was rejected — the room is stale (this account no longer has it, the supplied roomId doesn't match its live one, or the partner has already left), the text failed content validation ("blocked"), or the content was neither valid text nor a valid image ("invalid"). The client must never treat this as delivered. */
  | { type: "chat-failed"; roomId: string; clientMessageId: string; reason: "stale_room" | "blocked" | "invalid" }
  /** A friend-chat message — the Friends-panel equivalent of "chat" above. Sent ONLY to the recipient; the sender already has their own optimistic copy, reconciled via "friend-chat-sent" instead — mirroring how match chat's "chat" is only ever pushed to the partner, never echoed back to whoever sent it. */
  | { type: "friend-chat-message"; friendshipId: string; message: FriendChatMessage }
  /** Delivery acknowledgement for a "friend-chat-send" — `messageId`/`createdAt` are the real, server-assigned values, which may differ from whatever the client's optimistic render guessed. */
  | { type: "friend-chat-sent"; friendshipId: string; clientMessageId: string; messageId: string; createdAt: number }
  /** A "friend-chat-send" was rejected — the friendship doesn't exist (removed, or never did), one side has blocked the other, or the message failed content validation. The client must never treat this as delivered. */
  | { type: "friend-chat-error"; friendshipId: string; clientMessageId: string; reason: "not_friends" | "blocked" | "invalid" }
  | { type: "mic-state"; roomId: string; micEnabled: boolean }
  | { type: "typing"; roomId: string }
  | { type: "peer-left"; roomId: string }
  | { type: "reported" }
  /** `ok: false` means the block was NOT actually persisted (e.g. a database failure, or there was no live partner to block by the time this was processed) — the client must not present the interaction as blocked if this comes back false; see server/ws-server.ts's "block" handler and hooks/useMatchmaking.ts's handling of it. */
  | { type: "blocked"; ok: boolean }
  /** Ack for "unblock" — `ok` mirrors lib/db.ts's removeBlock() return value (whether a block row actually existed and was removed). */
  | { type: "unblocked"; ok: boolean; targetUserId: string }
  /** "hello" was rejected — an expired/invalid ticket, or an account status (banned/suspended) that changed after the ticket was minted. The client should re-fetch a ticket (invalid_ticket) or stop trying (banned/suspended). */
  | { type: "rejected"; reason: "invalid_ticket" | "banned" | "suspended" }
  /**
   * This connection lost a race for the same account against another,
   * already-healthy connection (a second tab/device, or a reconnect that
   * arrived before the previous socket had actually died) — sent right
   * before the server closes this socket with WS_CLOSE_SUPERSEDED below.
   * Deliberately NOT folded into "rejected" above: unlike an
   * invalid-ticket/banned/suspended rejection, this says nothing about the
   * *account* — the other connection is healthy and keeps working — so it
   * must never be treated as a reason to show an account-restricted
   * screen. See useSignalingSocket.ts, whose only reaction to this is to
   * stop retrying this specific socket rather than fighting the winner for
   * ownership forever.
   */
  | { type: "superseded" }
  /** `context` names which action the error is about, so the client can react appropriately (e.g. retry a failed "find" or "hello") instead of just logging it — "Message blocked." (chat) carries no context since there's nothing to retry there. `"hello"` specifically means hello was received but processing it threw (e.g. a database error) before "ready" could be sent — without this, the client would otherwise just wait for a "ready" that's never coming. */
  | { type: "error"; message: string; context?: "find" | "hello" }
  /**
   * How many accounts currently have a live, hello-accepted realtime
   * connection — sent right after this connection's own "ready", and
   * re-broadcast to every connected account whenever someone else connects
   * or disconnects, so it stays live while a guest is waiting rather than
   * only ever reflecting the moment they connected. Counts accounts, not
   * browser tabs — two tabs on the same account are one ConnectionState
   * (see server/ws-server.ts), so they count once.
   */
  | { type: "online-count"; count: number }
  /** The full current picture of friends/requests/blocks — sent right after a successful "hello", and re-sent to any online, affected account after any friends-related action (send/accept/decline/unfriend/block) so every open tab stays in sync without needing to diff granular events itself. */
  | {
      type: "friends-snapshot"
      friends: FriendSummary[]
      requestsReceived: ReceivedFriendRequest[]
      requestsSent: SentFriendRequest[]
      blocked: BlockedUserSummary[]
    }
  /** Tells the *sender* what happened to a specific "friend-request" they just sent — a snapshot alone can't convey "this one failed because you're already friends" vs. "this one failed because they're offline right now". */
  | { type: "friend-request-result"; targetDisplayId: string; result: FriendRequestResult }

export const WS_PATH = "/rizzuno-ws"

/**
 * Close code the server sends to a "hello" that lost the ownership race
 * for its account (see the "superseded" ServerMessage above and
 * server/ws-server.ts's hello handler). In the 4000-4999 range RFC 6455
 * §7.4.2 reserves for private/application use, so it can never collide
 * with a standard or `ws`-library-assigned code. useSignalingSocket.ts
 * checks for exactly this code in `onclose` to tell "the network dropped,
 * retry" apart from "another connection already owns this account, stop" —
 * conflating the two is what previously made a superseded socket
 * auto-reconnect forever, repeatedly re-triggering the same supersession
 * against whichever connection currently held the account.
 */
export const WS_CLOSE_SUPERSEDED = 4409
