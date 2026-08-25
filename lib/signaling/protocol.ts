/**
 * Wire protocol between the browser and the realtime server (server.ts).
 * Pure types + one const — safe to import from client code or the
 * standalone Node server alike.
 */

export type Gender = "male" | "female"

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
export type PublicPeerIdentity = Omit<PeerIdentity, "userId"> & { displayId: string }

/** Mirrors the browser's RTCIceCandidateInit shape without depending on DOM lib types. */
export type IceCandidateInit = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type RtcSignal =
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
export type FriendSummary = { id: string; userId: string; username: string | null; online: boolean; since: number }

/** A friend request someone else sent you — `id` is the request's own opaque id (used to accept/decline it), not the sender's account id, which this doesn't expose until you accept. */
export type ReceivedFriendRequest = { id: string; senderId: string; username: string | null; createdAt: number }

/** A friend request you sent — `recipientId` is included because, unlike an incoming request, you already necessarily learned it by choosing to send this (it's your own action, not exposure of a stranger's identity). */
export type SentFriendRequest = { id: string; recipientId: string; createdAt: number }

export type BlockedUserSummary = { userId: string; username: string | null }

export type FriendRequestResult =
  | "sent"
  | "auto_accepted"
  | "already_friends"
  | "already_requested"
  | "blocked"
  | "peer_offline"

export type ClientMessage =
  | {
      type: "hello"
      /** Minted by app/api/realtime/ticket — proves who this connection is on behalf of. The server verifies it and derives userId itself; nothing here is trusted at face value (see server/ws-server.ts). */
      ticket: string
      handle: string
      username?: string
      gender?: Gender
      profilePhoto?: string | null
    }
  | { type: "find" }
  | { type: "skip" }
  | { type: "leave" }
  | { type: "signal"; roomId: string; data: RtcSignal }
  | { type: "chat"; roomId: string; content: ChatContent }
  | { type: "report"; roomId: string; category: ReportCategory; details?: string }
  | { type: "block"; roomId: string }
  | { type: "mic-state"; roomId: string; micEnabled: boolean }
  | { type: "typing"; roomId: string }
  /** Sends a friend request to whoever currently holds this displayId — resolved server-side to a real account (see server/ws-server.ts's connectionsByDisplayId); the client never supplies or learns a target's real id here. */
  | { type: "friend-request"; targetDisplayId: string }
  | { type: "friend-respond"; requestId: string; accept: boolean }
  | { type: "unfriend"; friendshipId: string }
  /** Blocking someone you're already friends with (or have a pending request with) — `targetUserId` is one the client only ever learned from a prior friends-snapshot/request, i.e. a relationship it was already told about, not an arbitrary id it's guessing. */
  | { type: "friend-block"; targetUserId: string }

export type ServerMessage =
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
  | { type: "matched"; roomId: string; initiator: boolean; peer: PublicPeerIdentity; alreadyFriends: boolean }
  /** The current partner edited their own profile mid-call (e.g. set/changed their username) — same shape as "matched"'s peer, just a refresh rather than a new match. */
  | { type: "peer-updated"; roomId: string; peer: PublicPeerIdentity }
  | { type: "signal"; roomId: string; data: RtcSignal }
  | { type: "chat"; roomId: string; from: "peer"; content: ChatContent; ts: number }
  | { type: "mic-state"; roomId: string; micEnabled: boolean }
  | { type: "typing"; roomId: string }
  | { type: "peer-left"; roomId: string }
  | { type: "reported" }
  | { type: "blocked" }
  /** "hello" was rejected — an expired/invalid ticket, or an account status (banned/suspended) that changed after the ticket was minted. The client should re-fetch a ticket (invalid_ticket) or stop trying (banned/suspended). */
  | { type: "rejected"; reason: "invalid_ticket" | "banned" | "suspended" }
  | { type: "error"; message: string }
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
