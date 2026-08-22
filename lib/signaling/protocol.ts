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

export type ServerMessage =
  | { type: "queued" }
  | { type: "matched"; roomId: string; initiator: boolean; peer: PublicPeerIdentity }
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

/** Path the realtime WebSocket upgrades on — kept separate from Next's own internal upgrade traffic (e.g. HMR). */
export const WS_PATH = "/rizzuno-ws"
