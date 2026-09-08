"use client"
import { subscriptionHref } from "@/lib/upgradeNavigation"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { friendsCacheKey, parseFriendsCache } from "@/lib/friendsCache"
import { useSignalingSocket } from "./useSignalingSocket"
import { useWebRTC } from "./useWebRTC"
import { canSearch, isCurrentRoom } from "@/lib/realtimeLifecycle"
import { SignalBacklog } from "@/lib/signalBacklog"
import { nextMatchState, decideQueuePendingTimeout, MAX_AUTOMATIC_QUEUE_PENDING_RETRIES } from "@/lib/matchStateMachine"
import type { MatchState, MatchStateEvent } from "@/lib/matchStateMachine"
import type {
  ChatContent,
  MatchInvitation,
  Gender,
  PublicPeerIdentity,
  ReportCategory,
  RtcSignal,
  ServerMessage,
  FriendSummary,
  ReceivedFriendRequest,
  SentFriendRequest,
  BlockedUserSummary,
} from "@/lib/signaling/protocol"

// Re-exported from lib/matchStateMachine.ts, not redefined here — that file
// is the single source of truth for both the type AND the transition rules
// between its values (see its own doc comment for why it's a separate,
// framework-independent module: testability without a browser/React
// environment). Every setServerState call below that represents one of
// these named transitions goes through nextMatchState() rather than
// setting a literal, specifically so this hook's actual runtime behavior
// and tests/matchStateMachine.test.mts's coverage of it can never diverge.
export type { MatchState }
/**
 * `status` only ever applies to "me" messages — the sender's own optimistic
 * copy, shown "sending" until the server actually acknowledges it (see
 * sendChat()'s own doc comment for why appending locally was never enough
 * on its own). A "peer" message is never optimistic to begin with — it only
 * ever arrives already delivered — so it carries no status at all.
 */
export type ChatMessage = { id: string; from: "me" | "peer"; content: ChatContent; ts: number; status?: "sending" | "sent" | "failed" }
/** A friend-chat message, rendered the same way match chat is — `status` has the same "me"-message-only meaning ChatMessage's does. */
export type FriendChatEntry = { id: string; from: "me" | "peer"; text: string; ts: number; status?: "sending" | "sent" | "failed" }

// How long a match-chat/friend-chat send waits for the server's own
// delivery acknowledgement before giving up and marking itself "failed" —
// covers both "the transport looked open but wasn't really" and "the
// message genuinely got lost in flight", not just an outright-closed
// socket (useSignalingSocket.send() already drops that case immediately,
// synchronously, before this timeout would ever matter). Long enough for a
// normal round trip even over a slow connection; short enough that a
// person isn't left staring at "Sending…" for a message that's actually
// never coming.
const CHAT_ACK_TIMEOUT_MS = 8000

// What we show about the current match — always a real match, nothing
// fabricated. `userId` (the peer's real Google account id) is never part of
// this — see PublicPeerIdentity in lib/signaling/protocol.ts.
export type PeerProfile = PublicPeerIdentity

export type AccountRestriction =
  | { reason: "banned"; detail?: string | null }
  | { reason: "suspended"; until?: number }
  | { reason: "account_deleted" }
  | { reason: "acceptance_required" }
  /**
   * The server has rejected several consecutive "hello" attempts as
   * `invalid_ticket` in a row — a real, if rare, production fingerprint:
   * an EXPIRED ticket (the normal case "invalid_ticket" exists for) is a
   * one-off that a single immediate retry with a fresh ticket clears
   * right up. A ticket that's rejected every single time, repeatedly, is
   * a sign the signature verification itself can never succeed — the
   * single most likely cause being REALTIME_TICKET_SECRET not matching
   * between wherever tickets are minted (the Next.js app) and wherever
   * they're verified (the realtime server). Surfaced instead of retrying
   * forever in a silent, tight loop that would otherwise just exhaust the
   * ticket endpoint's own rate limit and then go quiet with nothing
   * visible to the person staring at "Finding someone…".
   */
  | { reason: "connection_failed" }

/** Per-displayId outcome of a friend request sent *this session* — not persisted client-side (there's nothing to persist: the server's friends-snapshot is the actual source of truth for confirmed friends/pending state; this is only for "I just clicked Add on this specific match/history row, what happened"). */
export type FriendRequestOutcome = "requested" | "friends" | "failed"

const MAX_HISTORY = 30
// How many "invalid_ticket" rejections in a row (with no successful "ready"
// in between) before giving up on the tight immediate-retry loop and
// surfacing AccountRestriction's "connection_failed" instead — see its own
// doc comment for what a streak this long actually indicates.
const CONSECUTIVE_INVALID_TICKET_LIMIT = 3
// Backoff between retries once that limit is hit — long enough to stop
// hammering /api/realtime/ticket (which rate-limits at 30/60s per account;
// a tight retry loop would exhaust that on its own within a few seconds),
// short enough that a since-fixed misconfiguration recovers within a
// reasonable wait rather than requiring a manual reload.
const CONNECTION_FAILED_RETRY_MS = 15_000
// How long "queue-pending" is allowed to sit unconfirmed before treating it
// as a dropped/lost "find" — long enough that a normal round trip (even a
// slow one) resolves well within it, short enough that a genuinely lost
// message doesn't leave the guest staring at "Finding someone…" (see
// StatusPill.tsx — queue-pending and searching share that label now)
// indefinitely without an actual queue entry behind it. See the
// ack-timeout effect below.
const QUEUE_PENDING_ACK_TIMEOUT_MS = 5000

export function useMatchmaking(
  /**
   * Whether realtime should exist at all — authentication owns this
   * lifecycle now (see MatchStage.tsx, which computes it from `signedIn &&
   * legalAccepted && profileHydrated && hasUsername && hasGender`). This
   * used to be implicit — the WebSocket connected unconditionally the
   * moment the component mounted, so a not-yet-legally-accepted or
   * not-yet-onboarded guest could still open a realtime connection and hit
   * "acceptance_required" from the ticket endpoint, which surfaced as
   * AccountRestricted ("terms changed, sign out and back in") instead of
   * just... not having connected yet, or correctly showing AgeGate. `false`
   * here means no realtime connection exists at all, not "connected but
   * idle" — see the teardown effect below for everything that resets when
   * this flips.
   */
  enabled: boolean,
  videoTrack: MediaStreamTrack | null,
  audioTrack: MediaStreamTrack | null,
  micEnabled: boolean,
  /** Cosmetic fallback display name — see lib/guest.ts. */
  myHandle: string,
  /** This user's own chosen username, if any — sent to the server so a real match can see it. */
  myUsername?: string,
  /** This user's own chosen gender, if any — sent to the server so it can only ever pair opposite genders. */
  myGender?: Gender,
  /** This user's own chosen profile photo, if any — sent to the server so a real match sees it too, not just an initial letter. */
  myProfilePhoto?: string | null,
  accountId?: string
) {
  const { connected, send, subscribe, supersededElsewhere, retryNow: retryRealtimeConnection } = useSignalingSocket(enabled, accountId)

  // `connected` only means the WebSocket transport opened — it says nothing
  // about whether the realtime server has actually verified our ticket and
  // finished processing "hello" yet (that's a real await chain server-side:
  // getUserStatus(), etc). Matching on `connected` alone let the client fire
  // "find" before the server had any ConnectionState for this socket, which
  // server/ws-server.ts silently drops (`if (!state) return`) — the guest
  // would then sit in "queue-pending" forever with nothing left to retry it.
  // `realtimeReady` instead only ever flips true when the server's own
  // "ready" ack (sent right after "hello" is fully processed — see
  // server/ws-server.ts) comes back, and flips false again on every
  // disconnect and every fresh "hello" attempt, so it never gets ahead of
  // what the server actually has registered for us.
  const [realtimeReady, setRealtimeReady] = useState(false)
  useEffect(() => {
    if (!realtimeReady) return
    // Search requests are persisted by the separate HTTP deployment.
    // Refresh here so the recipient receives them without reconnecting.
    const refresh = () => {
      if (document.visibilityState === "visible") send({ type: "friends-refresh" })
    }
    const timer = setInterval(refresh, 5000)
    document.addEventListener("visibilitychange", refresh)
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [realtimeReady, send])

  // `serverState` tracks what the signaling server has told us (queued,
  // matched, peer left). Whether the call is actually "active" is a
  // derived read of the live WebRTC connection, not a copy of it — see
  // `state` below.
  const [serverState, setServerState] = useState<MatchState>("idle")
  // Bumped every time serverState enters "queue-pending" (from findMatch(),
  // skip(), or block()'s eventual resume) — the ack-timeout effect further
  // down keys off this (not just serverState itself) specifically so a
  // second "queue-pending" entry restarts the 5s window even though the
  // state *value* didn't change (React effects don't re-run for a
  // dependency that re-renders with the same value).
  const [queuePendingAttempt, setQueuePendingAttempt] = useState(0)
  // How many automatic retries the current matchmaking attempt has already
  // used, out of MAX_AUTOMATIC_QUEUE_PENDING_RETRIES — a ref, not state:
  // nothing ever renders off this directly, only the ack-timeout effect's
  // own setTimeout callback reads/writes it. Reset to 0 on every genuinely
  // new/resumed attempt (findMatch()/skip()/block()), on real progress
  // ("queued"/"matched" received), on pauseMatching(), and on
  // disconnect/reconnect — see each of those call sites. Deliberately NOT
  // reset by the ack-timeout's own internal retry (sendFind(), never
  // findMatch()) — that retry is what's consuming this budget, not
  // starting a fresh one.
  const queuePendingRetryCountRef = useRef(0)
  const [roomId, updateRoomId] = useState<string | null>(null)
  const roomRef = useRef<string | null>(null)
  /**
   * The server's authoritative answer to "is the CURRENT room a random
   * match, or a direct/friend call?" (see "matched"'s `source` field in
   * lib/signaling/protocol.ts) — never guessed client-side. Read only when
   * the current room actually ends (peer-left, room-setup-failed), to
   * decide whether that ending should behave like an ordinary random-match
   * peer-left (resume searching, per wantsMatchingRef) or land back on
   * idle/home without ever implying random-match intent (a direct call
   * failing must never silently start random matchmaking). Cleared
   * whenever the room clears (see setRoomId below) — there is never a
   * meaningful "source of no room".
   */
  const roomSourceRef = useRef<"random" | "friend" | null>(null)
  const setRoomId = useCallback((next: string | null, reason: string) => {
    if (roomRef.current && next !== roomRef.current) {
      console.debug("matchmaking: room destroyed", { roomId: roomRef.current, reason })
    }
    roomRef.current = next
    if (next === null) roomSourceRef.current = null
    updateRoomId(next)
  }, [])
  // Which of THIS tab's own match-chat sends are still waiting on a
  // server ack — keyed by clientMessageId, holding that send's timeout
  // handle. See sendChat() and the "chat-sent"/"chat-failed" cases below.
  const pendingChatSendsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [initiator, setInitiator] = useState(false)
  const [peer, setPeer] = useState<PeerProfile | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peerMicEnabled, setPeerMicEnabled] = useState(true)
  const [peerTyping, setPeerTyping] = useState(false)
  // Set the moment the server rejects "hello" for an account-status reason
  // (banned/suspended/deleted) or the ticket endpoint itself refuses to mint
  // one — the UI should stop trying to matchmake and say why, not silently
  // spin in "searching" forever.
  const [restriction, setRestriction] = useState<AccountRestriction | null>(null)
  // The last 30 people this account has been matched with and moved on from —
  // recorded whenever a match ends, whatever the reason. Session-local, like
  // everything else here — nothing is sent anywhere to persist it.
  const [history, setHistory] = useState<PeerProfile[]>([])
  // How many accounts currently have a live connection — `null` until the
  // server's first "online-count" arrives (right after "ready"), so the UI
  // can tell "we don't know yet" apart from a genuine 0/1. Kept live for as
  // long as the socket stays connected (see server/ws-server.ts's
  // broadcastOnlineCount), not just a one-time snapshot from connect time.
  const [onlineCount, setOnlineCount] = useState<number | null>(null)
  const peerRef = useRef<PeerProfile | null>(null)
  useEffect(() => {
    peerRef.current = peer
  }, [peer])
  // Mirrors `serverState` for use inside the "error" handler below, which
  // needs the *current* value at the moment a delayed retry fires, not
  // whatever it was when the message arrived (the guest may have paused or
  // navigated away in between).
  const serverStateRef = useRef(serverState)
  useEffect(() => {
    serverStateRef.current = serverState
  }, [serverState])
  // Mirrors `realtimeReady` for sendFind() below to read without needing it
  // as a dependency (which would change that callback's identity on every
  // ready/not-ready flip, and with it every effect/prop that closes over
  // it — e.g. SwipeStage's own `onResume`). The server already silently
  // drops any non-"hello" message that arrives before it has processed
  // this connection's own hello (see server/ws-server.ts's "message before
  // hello — ignoring"), so a "find" sent too early was never actually
  // reaching the matchmaker — but it still optimistically entered
  // "queue-pending" client-side and started that state's own ack-timeout,
  // for an attempt the server never even saw. This closes that gap at the
  // source instead of only relying on the ack-timeout's retry (and,
  // failing that, the reconnect-resume effect below) to paper over it a
  // few seconds later.
  const realtimeReadyRef = useRef(realtimeReady)
  useEffect(() => {
    realtimeReadyRef.current = realtimeReady
  }, [realtimeReady])

  // Whether the guest currently *wants* automatic matching to be happening
  // — the "desired intent" this whole reconnect fix hinges on, kept
  // deliberately separate from `serverState` (which only reflects what the
  // server last actually told us, and goes stale the instant the socket
  // drops — see the effect below). Starts false: matching is never
  // auto-started (see MatchStage.tsx) — nothing sets this true until the
  // guest actually swipes for the first time. From then on, findMatch()
  // (called directly, by skip, the peer-left auto-retry, or a successful
  // block) sets it true; pauseMatching() and the full teardown effect are
  // the only things that set it back to false.
  //
  // A ref, not state, on purpose: it's read by the reconnect-resume effect
  // further down, and if it were state, flipping it inside findMatch()
  // would itself be a dependency change that re-triggers that same effect
  // a second time — double-sending "find" the moment the guest's own swipe
  // calls findMatch() directly (realtimeReady/roomId wouldn't have
  // changed, only this). A ref sidesteps that: writing to it
  // doesn't schedule a re-render or re-run any effect, so the reconnect
  // effect only ever re-evaluates when realtimeReady or roomId actually
  // change — a genuine reconnect or a room actually clearing, never this.
  const wantsMatchingRef = useRef(false)

  const recordHistory = useCallback((entry: PeerProfile | null) => {
    if (!entry) return
    setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
  }, [])

  // The transport dropping means whatever the server knew about us is gone
  // — server/ws-server.ts's close handler tears down both this account's
  // matchmaker queue entry and any active room the instant it sees the
  // close (and tells our old partner, if any, "peer-left" on their side).
  // Two things follow from that, and neither can wait for a "peer-left" of
  // our own (we're the one who disconnected — nothing will ever tell us):
  //
  //  1. `realtimeReady` must drop immediately — whatever "ready" we had
  //     described a ConnectionState the server no longer has.
  //  2. Any room we thought we were in must be treated as lost right now,
  //     not assumed to survive until told otherwise. Left alone, a stale
  //     `roomId` would also block the reconnect-resume effect below from
  //     ever re-sending "find", since it only fires when there's no room.
  //
  // `serverState` is only forced back to "queue-pending" here if we
  // actually had a room to lose (an idle/already-searching guest has no
  // room to begin with) and only if the guest still wants matching — if
  // they'd paused, pauseMatching() already cleared the room itself before
  // this could ever run. See the "queue-pending", not "searching" comment
  // just below for why that's the right target now, not the old
  // "searching" this used to force.
  useEffect(() => {
    if (connected) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtimeReady(false)
    // A real disconnect — whatever automatic-retry budget was in progress
    // belonged to a connection that's now gone; the reconnect-resume
    // effect's own fresh "find" (via findMatch()) would reset this anyway,
    // but clearing it right at the disconnect itself means it's never
    // stale even in the gap before that fires. Unconditional (not gated on
    // `roomId`) — this applies whether or not there was an active room.
    queuePendingRetryCountRef.current = 0
    if (!roomId) return
    console.log("matchmaking: transport dropped mid-room — treating the room as lost, not assuming it survived")
    recordHistory(peerRef.current)
    setRoomId(null, "socket_closed")
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    // "queue-pending", not "searching" — the transport just dropped, so
    // there is exactly as much server confirmation of a live search right
    // now as there is right after sending a fresh "find": none yet. Once
    // reconnected, the reconnect-resume effect further down sends a real
    // "find" (which re-enters "queue-pending" again anyway) and a genuine
    // "queued" is what actually promotes this to "searching" from there.
    if (wantsMatchingRef.current) setServerState("queue-pending")
  }, [connected, roomId, recordHistory, setRoomId])

  const signalListeners = useRef(new Map<string, (roomId: string, data: RtcSignal) => void>())
  // Ordered per-room backlog for "signal" messages that arrive before
  // useWebRTC has actually subscribed yet — see lib/signalBacklog.ts for
  // why this needs to exist and why it's a plain, framework-independent
  // class (unit-tested there, not through this hook).
  const signalBacklog = useRef(new SignalBacklog())
  const peerTypingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastTypingSentAt = useRef(0)

  // A fresh `roomId` (or none) means any leftover backlog from the
  // PREVIOUS room is definitely stale now — cleared on the way out of
  // whatever room this was, so it can never leak into a future one.
  useEffect(() => {
    const roomToClear = roomId
    const backlog = signalBacklog.current
    return () => {
      if (roomToClear) backlog.clear(roomToClear)
    }
  }, [roomId])

  // The real Friends backend — every value here ultimately traces back to
  // lib/db.ts's friend_requests/friendships tables via server/ws-server.ts's
  // "friends-snapshot" (sent after every hello, and re-sent after any
  // friends action affects this account), not local-only state.
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [matchInvitations, setMatchInvitations] = useState<MatchInvitation[]>([])
  const [matchInviteError, setMatchInviteError] = useState<string | null>(null)
  const inviteFriendToMatch = useCallback((targetUserId: string) => {
    setMatchInviteError(null)
    send({ type: "match-invite", targetUserId })
  }, [send])
  const respondToMatchInvitation = useCallback((invitationId: string, accept: boolean) => {
    setMatchInviteError(null)
    send({ type: "match-invite-respond", invitationId, accept })
  }, [send])

  // Friend-chat — rides this same authenticated socket (never a second
  // connection; see AGENTS' friend-chat architecture requirement).
  // Postgres (via server/ws-server.ts's "friend-chat-send"/"friend-chat-
  // read" handlers, see lib/db.ts) is the actual source of truth; this map
  // is rendered state/cache only — the live-arrived and just-sent messages
  // for whichever friendships this tab has touched this session. History
  // (GET /api/friends/messages/[friendshipId]) is fetched and merged in by
  // FriendsPanel.tsx itself, the same way it already fetches a friend's
  // real profile — this hook only ever appends to what's already here, it
  // never fetches history on its own.
  const [friendMessages, setFriendMessages] = useState<Map<string, FriendChatEntry[]>>(new Map())
  // Which of THIS tab's own optimistic sends are still waiting on a
  // server ack — keyed by clientMessageId, holding that send's timeout
  // handle so a late ack (or the timeout itself) can cancel/clear it
  // exactly once. See sendFriendChatMessage() and the "friend-chat-sent"/
  // "friend-chat-error" cases below.
  const pendingFriendChatSendsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    // Clear across account changes, not temporary socket loss. The server
    // restores unexpired invitations when this same account reconnects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatchInvitations([])
    setMatchInviteError(null)
    // Friend-chat cache is rendered state, not the source of truth (see
    // its own doc comment) — a different account must never see it. A
    // temporary socket loss on the SAME account is not an account change
    // (this effect doesn't fire for that), so a brief reconnect keeps
    // whatever was already cached, exactly like `friends` above.
    setFriendMessages(new Map())
    for (const timer of pendingFriendChatSendsRef.current.values()) clearTimeout(timer)
    pendingFriendChatSendsRef.current.clear()
  }, [accountId])
  const friendsAccountRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const previousAccount = friendsAccountRef.current
    friendsAccountRef.current = accountId
    let cached: FriendSummary[] = []
    try {
      if (previousAccount && previousAccount !== accountId) {
        sessionStorage.removeItem(friendsCacheKey(previousAccount))
      }
      if (accountId) cached = parseFriendsCache(sessionStorage.getItem(friendsCacheKey(accountId)))
    } catch { /* Storage may be disabled; the live snapshot still works. */ }
    // Hydrate before paint and never show another account's cached list.
    setFriends(cached)
  }, [accountId])
  const [friendRequestsReceived, setFriendRequestsReceived] = useState<ReceivedFriendRequest[]>([])
  const [friendRequestsSent, setFriendRequestsSent] = useState<SentFriendRequest[]>([])
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserSummary[]>([])
  // Keyed by displayId (never a real account id — see "friend-request" in
  // the protocol) — what happened the last time *this browser tab* asked to
  // friend whoever currently holds that displayId. Drives the FriendButton
  // shown for the current match and the "Add"/"Requested" state on a
  // History row, both of which only ever know a displayId, never a real id.
  const [friendActionState, setFriendActionState] = useState<Map<string, FriendRequestOutcome>>(new Map())
  // The most recently *newly arrived* incoming request this session — for
  // the live in-call toast. Detected by diffing consecutive snapshots
  // (below), not a separate push event, so the toast and the Friends
  // panel's inbox can never disagree about what's actually pending.
  const [friendToastRequestId, setFriendToastRequestId] = useState<string | null>(null)
  const previousReceivedIds = useRef<Set<string>>(new Set())

  const sendSignal = useCallback(
    (room: string, data: RtcSignal) => send({ type: "signal", roomId: room, data }),
    [send]
  )

  const onSignal = useCallback((room: string, handler: (roomId: string, data: RtcSignal) => void) => {
    signalListeners.current.set(room, handler)
    // Replay only this room; an outgoing room's subscriber must never
    // consume the next room's early offer during the React effect handoff.
    console.log("webrtc: room initialized — flushing any buffered signals")
    signalBacklog.current.drain(room, handler)
    return () => {
      if (signalListeners.current.get(room) === handler) signalListeners.current.delete(room)
    }
  }, [])

  // The server's "rtc-start" for the room named here — see that message's
  // own doc comment in lib/signaling/protocol.ts. Room-scoped by
  // comparison against `roomId` below (via `rtcStart`, not this raw state
  // value directly) rather than reset to null on every room change: a
  // stale roomId sitting here from a room that's since ended is harmless
  // and automatically stops mattering the instant `roomId` no longer
  // matches it, exactly like `isCurrentRoom`'s own pattern used throughout
  // this file.
  const [rtcStartRoomId, setRtcStartRoomId] = useState<string | null>(null)
  const rtcStart = rtcStartRoomId !== null && rtcStartRoomId === roomId

  const { remoteStream, remoteVideoReady, rtcInitialized, status: rtcStatus, reportPlaybackConfirmed } = useWebRTC({
    roomId,
    initiator,
    videoTrack,
    audioTrack,
    micEnabled,
    rtcStart,
    sendSignal,
    onSignal,
  })

  /**
   * Sends "rtc-ready" exactly once per room, only once every real
   * prerequisite the room-establishment handshake actually needs is true —
   * see that message's own doc comment in lib/signaling/protocol.ts for
   * the exact bullet list this satisfies:
   *
   *  - `rtcInitialized` (useWebRTC.ts): the RTCPeerConnection, its video/
   *    audio transceivers, and this room's own signal listener all exist.
   *  - `realtimeReady`: the transport is genuinely up, not just "was, a
   *    moment ago".
   *  - a LIVE local video track: makes this hook's own readiness check
   *    authoritative, not just the pre-call UI gate on `videoTrack`
   *    existing (see MatchStage.tsx) — media that temporarily
   *    disappeared mid-setup (a device sleep, a permission hiccup) must
   *    never be claimed ready; this simply doesn't fire until
   *    useLocalMedia's own recovery brings a live track back (or never
   *    fires at all, in which case the server's own bounded setup
   *    deadline is what cleanly ends the attempt — see "room-setup-
   *    failed").
   *
   * `rtcReadySentForRoomRef` is compared against `roomId` itself (never
   * reset separately) — a fresh room simply won't match whatever the ref
   * held for the previous one, so this naturally fires again for a new
   * room without any explicit reset logic that could itself drift out of
   * sync.
   */
  const rtcReadySentForRoomRef = useRef<string | null>(null)
  useEffect(() => {
    if (!roomId) return
    if (rtcReadySentForRoomRef.current === roomId) return
    if (!rtcInitialized || !realtimeReady) return
    if (!videoTrack || videoTrack.readyState !== "live") return
    rtcReadySentForRoomRef.current = roomId
    console.log("matchmaking: rtc-ready", { roomId })
    send({ type: "rtc-ready", roomId })
  }, [roomId, rtcInitialized, realtimeReady, videoTrack, send])

  /**
   * The one place a peer VideoTile (rendered well downstream, by
   * SwipeStage.tsx) can feed real playback evidence back into this
   * hook's own readiness state — see useWebRTC.ts's `remoteVideoReady`
   * doc comment for why stats proof alone (getStats().framesDecoded)
   * isn't reliable enough on its own: iOS Safari in particular can render
   * remote video correctly while that counter is missing, delayed, or
   * unreliable, which used to leave a genuinely working call stuck on
   * "Connecting" forever.
   *
   * `isCurrentRoom` — the same staleness guard "chat"/"signal"/"typing"/
   * etc. already use above — is what makes a stale report from a room
   * that's already ended (or an earlier one, before a fresh match) unable
   * to mark a LATER room ready; useWebRTC.ts's own reportPlaybackConfirmed
   * independently re-checks the same thing against its own room-effect
   * instance, so this is intentionally double-guarded, not relying on
   * either check alone.
   */
  const reportRemoteVideoPlaying = useCallback(
    (forRoomId: string) => {
      if (!isCurrentRoom(roomRef.current, forRoomId)) return
      reportPlaybackConfirmed(forRoomId)
    },
    [reportPlaybackConfirmed]
  )

  // The connection is genuinely "active" once WebRTC media is actually
  // flowing — `rtcStatus === "connected"` alone only means ICE/DTLS
  // negotiation succeeded, which is NOT the same thing (a connection can
  // report "connected" with zero remote video frames ever actually
  // decoding). `remoteVideoReady` (see useWebRTC.ts) is the real signal —
  // proven by EITHER getStats() confirming real decoded frames OR the
  // peer's actual <video> element having genuinely reached "playing"
  // (reportRemoteVideoPlaying above, fed by VideoTile.tsx via
  // SwipeStage.tsx). Until one of those two proofs exists, `state` stays
  // whatever `serverState` already is — "connecting" from the moment
  // "matched" was received (see nextMatchState's "matched-received"
  // case) — rather than showing the matched-profile UI over what would
  // otherwise be an empty peer tile.
  const state: MatchState = roomId ? (rtcStatus === "connected" && remoteVideoReady ? "active" : "connecting") : serverState

  /**
   * Chat availability, deliberately independent of `state`/video above.
   * A server-confirmed "matched" already establishes a real, valid peer
   * relationship (a roomId, a real `peer`) well before WebRTC video
   * finishes negotiating — chat has no reason to wait on decoded frames
   * that have nothing to do with whether the two of you can exchange
   * text. `realtimeReady` guards the one real prerequisite instead: the
   * transport has to actually be up to send anything at all. Consumers
   * (MatchStage.tsx) still combine this with their own `!pendingSkip` —
   * that's presentational masking this hook has no reason to know about,
   * not a matchmaking/video concern.
   */
  const hasCurrentRoom = roomId !== null
  const canMatchChat = realtimeReady && hasCurrentRoom && Boolean(peer)

  // The one place any code path is allowed to claim "we're trying to get
  // into the queue" — never "searching" itself; see
  // lib/matchStateMachine.ts's own doc comment for the actual rule. Only
  // the server's own "queued" message (see the message switch below) may
  // promote this to "searching"; this just marks the attempt (via
  // nextMatchState, so it's provably the same rule tests/
  // matchStateMachine.test.mts exercises) and starts its ack-timeout window
  // (via the attempt counter — see its own doc comment).
  const enterQueuePending = useCallback((event: Extract<MatchStateEvent, { type: "find-sent" | "skip-sent" | "block-sent" }>) => {
    setServerState((prev) => nextMatchState(prev, event))
    setQueuePendingAttempt((n) => n + 1)
  }, [])

  // The actual "find" send + queue-pending entry, shared by findMatch()
  // below and the ack-timeout effect's own bounded retry — deliberately
  // does NOT touch queuePendingRetryCountRef itself. findMatch() (a
  // genuinely new/resumed attempt) resets that counter before calling
  // this; the ack-timeout's retry calls this directly, bypassing the
  // reset, because that retry is what's spending the budget, not
  // refilling it.
  const sendFind = useCallback(() => {
    if (!canSearch(roomRef.current)) return
    // The intent is recorded regardless of readiness — that's what lets a
    // swipe/findMatch() that arrives a beat before "ready" still work: the
    // reconnect-resume effect below fires a real find() itself the moment
    // realtimeReady actually turns true, from this same recorded intent.
    // What's skipped when not ready is only entering "queue-pending" and
    // actually sending "find" — the server drops any non-"hello" message
    // before it's processed this connection's own hello anyway (see
    // realtimeReadyRef's own doc comment), so there is nothing correct to
    // send yet, and optimistically showing "Finding someone…" for an
    // attempt the server never saw would only resolve itself via the
    // ack-timeout's retry a few seconds later — needless, avoidable churn.
    wantsMatchingRef.current = true
    if (!realtimeReadyRef.current) return
    enterQueuePending({ type: "find-sent" })
    send({ type: "find" })
  }, [send, enterQueuePending])

  const findMatch = useCallback(() => {
    if (!canSearch(roomRef.current)) return
    console.log("matchmaking: sending find")
    queuePendingRetryCountRef.current = 0
    sendFind()
  }, [sendFind])

  // Leaves the real server-side queue WITHOUT touching `wantsMatching` or
  // showing "paused" — used when something external and temporary makes
  // matching impossible right now (e.g. the camera turning off mid-search;
  // see MatchStage.tsx's camera-controls-queue-membership effect), where
  // the guest hasn't actually changed their mind about wanting to match.
  // `serverState` goes back to "idle" specifically so StatusPill's existing
  // camera-access guidance ("Camera access is required to start matching") is what
  // shows, instead of "Finding someone…" over a queue entry that doesn't
  // actually exist server-side anymore. Cancels either
  // "searching" (confirmed queued) or "queue-pending" (asked, not yet
  // confirmed) the same way — camera-off ends the attempt regardless of
  // which stage it was at.
  const leaveQueueOnly = useCallback(() => {
    if (roomRef.current) return
    console.log("matchmaking: leaving queue only (not a pause — wantsMatching stays true)")
    send({ type: "leave" })
    setServerState((prev) => nextMatchState(prev, { type: "left-queue" }))
    // The attempt this budget belonged to is over — whatever comes next
    // (camera back on) is findMatch()'s own fresh attempt anyway, which
    // resets this itself, but clearing it here too means nothing stale
    // lingers while no attempt is even in flight.
    queuePendingRetryCountRef.current = 0
  }, [send])

  const skip = useCallback(() => {
    recordHistory(peerRef.current)
    setRoomId(null, "user_skip")
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    // A genuinely new search — gets its own fresh retry budget, not
    // whatever was left over from a previous, unrelated attempt.
    queuePendingRetryCountRef.current = 0
    enterQueuePending({ type: "skip-sent" })
    send({ type: "skip" })
  }, [send, recordHistory, enterQueuePending, setRoomId])

  /**
   * Appending a message to `messages` the instant it's sent used to mean
   * "sent" as far as the sender could see — but useSignalingSocket.send()
   * silently drops a message whenever the transport isn't OPEN (see its
   * own doc comment), so a send attempted mid-reconnect (or one that
   * genuinely gets lost) left the sender looking at a message that never
   * reached Railway, let alone the partner. The message now renders
   * immediately either way (optimistic, `status: "sending"`), but only
   * ever becomes `"sent"` once the server's own "chat-sent" ack arrives
   * (see the subscribe() switch below) — the client never decides that on
   * its own. `!connected` fails fast without waiting out the timeout;
   * `CHAT_ACK_TIMEOUT_MS` catches everything else that never gets a reply
   * (a reconnect that looked open but wasn't, a message genuinely lost).
   *
   * Deliberately does NOT retry automatically, and the ack-timeout for a
   * given send is torn down the moment the ROOM it was sent into ends (see
   * the cleanup effect below) — a stale ack/timeout must never touch a
   * later room's messages, and this must never silently replay a
   * room-scoped send into a room that may no longer exist.
   */
  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 500)
      const room = roomRef.current
      if (!trimmed || !room) return
      const clientMessageId = crypto.randomUUID()
      console.debug("match-chat: send requested", { roomId: room })
      setMessages((prev) => [
        ...prev,
        { id: clientMessageId, from: "me", content: { kind: "text", text: trimmed }, ts: Date.now(), status: "sending" },
      ])
      if (!connected) {
        console.debug("match-chat: send failed transport unavailable", { roomId: room })
        setMessages((prev) => prev.map((m) => (m.id === clientMessageId ? { ...m, status: "failed" } : m)))
        return
      }
      const timer = setTimeout(() => {
        pendingChatSendsRef.current.delete(clientMessageId)
        console.debug("match-chat: send failed transport unavailable", { roomId: room })
        setMessages((prev) => prev.map((m) => (m.id === clientMessageId && m.status === "sending" ? { ...m, status: "failed" } : m)))
      }, CHAT_ACK_TIMEOUT_MS)
      pendingChatSendsRef.current.set(clientMessageId, timer)
      send({ type: "chat", roomId: room, clientMessageId, content: { kind: "text", text: trimmed } })
    },
    [send, connected]
  )

  // A room that's ended can never produce a real ack for a send made into
  // it — clearing every pending timer the instant `roomId` changes (this
  // fires on skip/peer-left/a fresh match/teardown alike) is what "do not
  // automatically replay room-specific messages after reconnect because
  // the old room may no longer exist" actually means for THIS side of the
  // flow: nothing here ever fires a stale ack-timeout against a later
  // room's `messages` (which setRoomId's own callers already reset to []
  // on every room change anyway — this just stops the dangling timers,
  // not a visible symptom on its own).
  useEffect(() => {
    const pending = pendingChatSendsRef.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [roomId])

  // Throttled so every keystroke doesn't hit the wire.
  const notifyTyping = useCallback(() => {
    if (!roomId) return
    const now = Date.now()
    if (now - lastTypingSentAt.current < 1500) return
    lastTypingSentAt.current = now
    send({ type: "typing", roomId })
  }, [roomId, send])

  const report = useCallback(
    (category: ReportCategory, details?: string) => {
      if (!roomId) return
      send({ type: "report", roomId, category, details })
    },
    [roomId, send]
  )

  const block = useCallback(() => {
    recordHistory(peerRef.current)
    if (!roomId) return
    // Terminates the interaction locally right away, unconditionally — a
    // real database write (server/ws-server.ts's addBlock) still has to
    // succeed or fail, but safety doesn't wait on that: see the "blocked"
    // case in the message switch below for what happens once the server
    // actually confirms it (including re-starting the search). Optimistic
    // "queue-pending" here (not "searching" — nothing's confirmed yet, and
    // no "find" has even been sent server-side until the "blocked" ack
    // itself triggers one) just so the UI shows *something* right away
    // instead of a blank gap; the ack-timeout effect covers this exactly
    // like any other queue-pending entry if that ack is slow or lost.
    send({ type: "block", roomId })
    setRoomId(null, "blocked")
    setPeer(null)
    // A genuinely new (about to be) search — its own fresh retry budget.
    queuePendingRetryCountRef.current = 0
    enterQueuePending({ type: "block-sent" })
  }, [roomId, send, recordHistory, enterQueuePending, setRoomId])

  /** Reverses a block this account previously placed — see server/ws-server.ts's "unblock" handler and lib/db.ts's removeBlock(). `targetUserId` only ever comes from this account's own blocked-users snapshot. */
  const unblockUser = useCallback(
    (targetUserId: string) => {
      console.log("matchmaking: sending unblock")
      send({ type: "unblock", targetUserId })
    },
    [send]
  )

  // Sends a friend request to whoever currently holds `targetDisplayId` —
  // the current match's peer, or a past match from History. The server
  // resolves the real account behind it (or reports "peer_offline" if
  // nobody currently does) — see "friend-request-result" below for how the
  // outcome comes back.
  const sendFriendRequestTo = useCallback(
    (targetDisplayId: string) => {
      send({ type: "friend-request", targetDisplayId })
    },
    [send]
  )

  const respondToFriendRequest = useCallback(
    (requestId: string, accept: boolean) => {
      send({ type: "friend-respond", requestId, accept })
      if (friendToastRequestId === requestId) setFriendToastRequestId(null)
    },
    [send, friendToastRequestId]
  )

  const unfriend = useCallback(
    (friendshipId: string) => {
      send({ type: "unfriend", friendshipId })
    },
    [send]
  )

  /** Blocking someone you're already friends with (or have a pending request with) — a real account id, but one this tab was already told (via a snapshot), never one it's guessing. See lib/db.ts's addBlock(), which also severs any friendship/pending request the same way the in-call `block()` above does. */
  const blockFriendAccount = useCallback(
    (targetUserId: string) => {
      send({ type: "friend-block", targetUserId })
    },
    [send]
  )

  const dismissFriendToast = useCallback(() => setFriendToastRequestId(null), [])

  /**
   * Sends a real, persisted friend-chat message over this same socket (see
   * AGENTS: "DO NOT create a second WebSocket for Friends chat"). Mirrors
   * sendChat() above exactly: renders optimistically (`status: "sending"`)
   * immediately, but only the server's own "friend-chat-sent"/
   * "friend-chat-error" (see the subscribe() switch below) ever moves it
   * to "sent"/"failed" — appending locally was the entire bug this
   * replaces (FriendsPanel.tsx used to do only that, with nothing behind
   * it at all).
   */
  const sendFriendChatMessage = useCallback(
    (friendshipId: string, text: string) => {
      const trimmed = text.trim().slice(0, 500)
      if (!trimmed || !friendshipId) return
      const clientMessageId = crypto.randomUUID()
      console.debug("friend-chat: send requested", { friendshipId })
      setFriendMessages((prev) => {
        const next = new Map(prev)
        const existing = next.get(friendshipId) ?? []
        next.set(friendshipId, [...existing, { id: clientMessageId, from: "me", text: trimmed, ts: Date.now(), status: "sending" }])
        return next
      })
      const markFailed = () => {
        setFriendMessages((prev) => {
          const existing = prev.get(friendshipId)
          if (!existing) return prev
          const next = new Map(prev)
          next.set(
            friendshipId,
            existing.map((m) => (m.id === clientMessageId && m.status === "sending" ? { ...m, status: "failed" } : m))
          )
          return next
        })
      }
      if (!connected) {
        console.debug("friend-chat: send failed transport unavailable", { friendshipId })
        markFailed()
        return
      }
      const timer = setTimeout(() => {
        pendingFriendChatSendsRef.current.delete(clientMessageId)
        console.debug("friend-chat: send failed transport unavailable", { friendshipId })
        markFailed()
      }, CHAT_ACK_TIMEOUT_MS)
      pendingFriendChatSendsRef.current.set(clientMessageId, timer)
      send({ type: "friend-chat-send", friendshipId, clientMessageId, text: trimmed })
    },
    [send, connected, setFriendMessages]
  )

  /** Marks a friendship's received messages read — sent when its conversation opens, and again for any later message that arrives while it's still open (see FriendsPanel.tsx). The server re-sends a fresh friends-snapshot in response, which is what actually zeroes this friend's `unreadCount` — see lib/db.ts's markFriendMessagesRead(). */
  const markFriendChatRead = useCallback(
    (friendshipId: string) => {
      if (!friendshipId) return
      send({ type: "friend-chat-read", friendshipId })
    },
    [send]
  )

  // Ends any current call (recording it to history like a normal skip) and
  // tells the server to drop this guest from the queue entirely — a real
  // "leave", not just "search for someone else" — so no unnecessary
  // signaling/matching work keeps happening in the background. Resuming is
  // just calling findMatch() again.
  const pauseMatching = useCallback(() => {
    recordHistory(peerRef.current)
    // The one place this flips back to false during a normal session — a
    // reconnect after this must NOT auto-enqueue the guest again (see the
    // reconnect-resume effect below, which checks this before ever sending
    // a fresh "find").
    wantsMatchingRef.current = false
    setRoomId(null, "user_leave")
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    // Unconditional — cancels "queue-pending" exactly the same way it
    // cancels "searching"/"connecting"/anything else: pausing always wins,
    // regardless of what was in flight.
    setServerState((prev) => nextMatchState(prev, { type: "paused" }))
    send({ type: "leave" })
    // Whatever attempt was in flight is over — resuming later is
    // findMatch()'s own fresh attempt regardless, but clear it here too so
    // nothing stale survives a pause.
    queuePendingRetryCountRef.current = 0
  }, [send, recordHistory, setRoomId])

  // Refs mirroring the latest profile field values — read at call time
  // inside announce()/the profile-update effect below, deliberately NOT
  // used as either callback's own dependency. If they were, editing your
  // username while already connected would change announce()'s identity,
  // which would re-run the "announce on connect" effect further down and
  // re-send a full "hello" for what should be a routine profile edit —
  // exactly the out-of-order-identity-update problem a separate
  // "profile-update" message (see lib/signaling/protocol.ts) exists to fix.
  const latestUsernameRef = useRef(myUsername)
  const latestGenderRef = useRef(myGender)
  const latestProfilePhotoRef = useRef(myProfilePhoto)
  useEffect(() => {
    latestUsernameRef.current = myUsername
    latestGenderRef.current = myGender
    latestProfilePhotoRef.current = myProfilePhoto
  }, [myUsername, myGender, myProfilePhoto])

  // This connection's own profile-update revision counter (see
  // lib/signaling/protocol.ts's "profile-update") — reset to 0 by announce()
  // every time a fresh "hello" goes out (a new connection/auth generation),
  // since hello's own payload already IS that generation's revision-0
  // baseline. `lastSentProfileRef` is what the effect below diffs against
  // to decide whether anything has *actually* changed since the last thing
  // sent (hello or a profile-update) — seeded by announce() to exactly
  // whatever hello just sent, so the first render after a fresh "ready"
  // never sees a false "changed" and fires a redundant profile-update
  // immediately after hello already carried the same values.
  const profileRevisionRef = useRef(0)
  const lastSentProfileRef = useRef<{ username?: string; gender?: Gender; profilePhoto?: string | null } | null>(null)

  // How many "invalid_ticket" rejections have landed in a row, with nothing
  // successful in between — see AccountRestriction's "connection_failed"
  // for what this protects against. Reset to 0 on a successful "ready".
  const invalidTicketStreakRef = useRef(0)

  // Always holds the latest `announce`, kept in sync just below its own
  // definition — used for announce()'s two internal delayed-retry calls
  // (rate-limited ticket fetch; too many invalid_ticket rejections in a
  // row) so they don't reference `announce` from inside its own body. A
  // function calling itself by name inside its own closure works fine at
  // runtime (the delayed callback only ever runs long after the `const`
  // assignment completes) but not everything is happy analyzing that
  // shape statically — routing through a ref sidesteps it cleanly.
  const announceRef = useRef<() => void>(() => {})

  // Mints a fresh, short-lived realtime ticket from the authenticated
  // session (see app/api/realtime/ticket) and announces this connection to
  // the server with it — never a bare self-declared id (spec: "never trust
  // a user ID supplied by the client without server verification"). Runs
  // only on every (re)connect now — see the profile-update effect below for
  // what handles a username/gender/photo change on an already-open
  // connection instead (the server preserves any in-progress room across a
  // reconnect's re-hello, it isn't treated as abandoning it).
  const announce = useCallback(async () => {
    if (!myHandle) return
    // Every fresh "hello" attempt invalidates whatever "ready" we had —
    // either we're not connected to say it to anyone yet, or (on an actual
    // reconnect) the old ack no longer describes the connection's current
    // state until a new one arrives.
    setRealtimeReady(false)
    try {
      const res = await fetch("/api/realtime/ticket")
      if (!res.ok) {
        const body: { error?: string; until?: number; reason?: string | null } = await res.json().catch(() => ({}))
        console.warn("matchmaking: ticket request failed — not sending hello", { status: res.status, error: body.error })
        if (body.error === "banned") setRestriction({ reason: "banned", detail: body.reason })
        else if (body.error === "suspended") setRestriction({ reason: "suspended", until: body.until })
        else if (body.error === "account_deleted") setRestriction({ reason: "account_deleted" })
        else if (body.error === "acceptance_required") setRestriction({ reason: "acceptance_required" })
        else if (body.error === "rate_limited") {
          // Previously fell through to the bare `return` below with nothing
          // scheduled to ever retry it — the socket's own reconnect only
          // fires this again on an actual transport disconnect, which
          // might not happen for a long time (or at all) while the
          // transport itself stays perfectly open. That left a guest
          // permanently stuck with no ticket, no hello, no "ready", and no
          // visible explanation. A short, one-shot delayed retry (this
          // limit is generous — 30/60s — so a single rate-limit hit is
          // almost always transient, not a sign of anything actually
          // wrong) fixes that without needing a restriction screen for
          // what's normally a non-issue.
          console.warn("matchmaking: ticket endpoint rate-limited — retrying shortly")
          setTimeout(() => announceRef.current(), 5000)
        }
        return
      }
      const { ticket } = (await res.json()) as { ticket: string }
      setRestriction(null)
      const username = latestUsernameRef.current
      const gender = latestGenderRef.current
      const profilePhoto = latestProfilePhotoRef.current
      profileRevisionRef.current = 0
      lastSentProfileRef.current = { username: username || undefined, gender, profilePhoto }
      console.log("matchmaking: sending hello")
      send({
        type: "hello",
        ticket,
        handle: myHandle,
        username: username || undefined,
        gender,
        profilePhoto,
      })
    } catch {
      // Network hiccup minting the ticket — the socket's own reconnect will
      // trigger this again; nothing to announce this time around.
      console.warn("matchmaking: ticket fetch threw (network hiccup) — will retry on next reconnect")
    }
  }, [myHandle, send])

  useEffect(() => {
    announceRef.current = announce
  }, [announce])

  useEffect(() => {
    // Reacting to an external system (the socket just (re)connected) by
    // fetching a ticket and telling the server who we are — not mirroring
    // existing React state, so the setState calls inside announce() (on the
    // ticket response) are the intended outcome here, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) announce()
  }, [connected, announce])

  // Sends a "profile-update" (never a repeat "hello" — see its own doc
  // comment) whenever username/gender/profilePhoto actually change while
  // already connected and ready. Compares against `lastSentProfileRef`
  // (seeded by announce() to whatever hello/the last profile-update already
  // sent) so this never fires for a value that's already been communicated
  // — including right after a fresh "ready", when hello just sent the exact
  // same snapshot this effect would otherwise see as "new".
  useEffect(() => {
    if (!realtimeReady) return
    const current = { username: myUsername || undefined, gender: myGender, profilePhoto: myProfilePhoto }
    const last = lastSentProfileRef.current
    if (last && last.username === current.username && last.gender === current.gender && last.profilePhoto === current.profilePhoto) {
      return
    }
    profileRevisionRef.current += 1
    const revision = profileRevisionRef.current
    const genderChanged = Boolean(last && last.gender !== current.gender)
    lastSentProfileRef.current = current
    console.log("matchmaking: sending profile-update", { revision, genderChanged })
    send({ type: "profile-update", revision, ...current })
  }, [realtimeReady, myUsername, myGender, myProfilePhoto, send])

  useEffect(() => {
    return subscribe((message: ServerMessage) => {
      switch (message.type) {
        case "ready":
          // The server has finished processing our "hello" and actually has
          // a ConnectionState registered for this socket — only now is it
          // safe to send "find" and expect anything other than silence.
          console.log("matchmaking: realtime ready (hello accepted)")
          setRealtimeReady(true)
          // A real "ready" proves the ticket round trip genuinely works —
          // whatever invalid_ticket streak was building (if any) is over.
          invalidTicketStreakRef.current = 0
          // A fresh connection/reconnect — whatever automatic-retry budget
          // a PREVIOUS connection's attempt had used is irrelevant now; the
          // reconnect-resume effect below sends its own fresh "find" (which
          // resets this anyway via findMatch()), but clearing it here too
          // means it's never stale even in the gap before that fires.
          queuePendingRetryCountRef.current = 0
          break
        case "queued":
          if (roomRef.current) break
          console.log("matchmaking: queued")
          // The ONLY promotion to "searching" — see nextMatchState's own
          // doc comment for exactly which prior states accept it (only an
          // attempt that's still genuinely current) and which don't (the
          // guest already backed out — accepting it anyway would resurrect
          // "Finding someone…" over a search they already cancelled). Real
          // progress — this attempt is confirmed, so its retry budget is
          // spent for nothing; a FUTURE stall (e.g. after a later skip)
          // deserves its own fresh one.
          setServerState((prev) => nextMatchState(prev, { type: "queued-received" }))
          queuePendingRetryCountRef.current = 0
          break
        case "matched":
          if (roomRef.current) break // Duplicate/stale matches cannot replace a live room.
          console.log("matchmaking: matched", { roomId: message.roomId, initiator: message.initiator, source: message.source })
          setRoomId(message.roomId, "matched")
          roomSourceRef.current = message.source
          // ONLY a genuinely random match implies "keep automatically
          // finding someone if this ends" — a direct/friend call starts
          // from idle/paused, without a find, and must NOT be treated as
          // random-match intent (see roomSourceRef's own doc comment and
          // the "peer-left"/"room-setup-failed" handling below, which is
          // what actually reads this back). Left untouched (not forced
          // false) for `source === "friend"` — an independent random
          // search that was somehow already in flight survives a direct
          // call exactly as it would survive anything else, it's just
          // never STARTED by accepting one.
          if (message.source === "random") wantsMatchingRef.current = true
          setInitiator(message.initiator)
          setPeer(message.peer)
          setMessages([])
          setPeerMicEnabled(true) // unknown until they tell us — assume on until we hear otherwise
          setPeerTyping(false)
          // Wins outright regardless of prior state — including straight
          // from "queue-pending" when the server pairs you before a
          // "queued" ack would even be worth sending (see
          // lib/matchStateMachine.ts's own doc comment on this exact case).
          setServerState((prev) => nextMatchState(prev, { type: "matched-received" }))
          // Real progress — same reasoning as "queued" above.
          queuePendingRetryCountRef.current = 0
          // If this match happens to already be a friend (matching doesn't
          // exclude friends — only recent-partners and blocks), reflect
          // that immediately instead of showing "Add" for someone you're
          // already friends with.
          if (message.alreadyFriends) {
            setFriendActionState((prev) => {
              const next = new Map(prev)
              next.set(message.peer.displayId, "friends")
              return next
            })
          }
          break
        case "peer-updated":
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          // The partner edited their own profile mid-call — merge the
          // refreshed identity into the peer we already have.
          setPeer((prev) => (prev ? { ...prev, ...message.peer } : prev))
          break
        case "rtc-start":
          // Room-scoped via isCurrentRoom the same way every other
          // room-addressed message here is — a stale "rtc-start" for a
          // room that's since ended (or an earlier one, before a fresh
          // match) must never activate negotiation in a LATER room. See
          // `rtcStart`'s own computation above (compares this state
          // against the CURRENT roomId, not just recorded here blindly)
          // for the second, independent layer of that same guard.
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          console.log("matchmaking: rtc-start received", { roomId: message.roomId })
          setRtcStartRoomId(message.roomId)
          break
        case "room-setup-failed": {
          // Same staleness guard as every other room-addressed message —
          // a failure notice for a room this tab has already moved on
          // from (a reconnect's fresh room, an explicit leave that beat
          // the server's own notice here) must be a no-op.
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          console.warn("matchmaking: room setup failed — never became ready in time", {
            roomId: message.roomId,
            source: message.source,
          })
          recordHistory(peerRef.current)
          setRoomId(null, "setup_timeout")
          setPeer(null)
          setPeerMicEnabled(true)
          setPeerTyping(false)
          if (message.source === "friend") {
            // A direct/friend call failing must never look like — or
            // behave like — an ordinary random-match peer-left (which
            // auto-retries into random searching below). Straight to
            // idle/home, same as any other direct-call ending — see
            // "matched"'s own `source` field and its doc comment.
            setServerState((prev) => nextMatchState(prev, { type: "reset-idle" }))
            // The one narrow exception the spec actually calls for: an
            // independent random-search intent that was somehow ALREADY
            // in flight (wantsMatchingRef true despite this being a
            // direct call — accepting one already requires not currently
            // seeking, so this is rare) survives exactly like it would
            // survive anything else, rather than being silently dropped
            // just because THIS particular attempt was a direct call.
            if (wantsMatchingRef.current) findMatch()
          } else {
            setServerState((prev) => nextMatchState(prev, { type: "peer-left-received" }))
            // wantsMatchingRef is already true for a random-sourced room
            // (set at "matched" time above) — the existing peer-left
            // auto-retry effect further down is what actually resumes
            // searching; nothing else to do here.
          }
          break
        }
        case "signal": {
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          const kind = message.data.kind
          const listener = signalListeners.current.get(message.roomId)
          if (listener) {
            listener(message.roomId, message.data)
          } else {
            // No useWebRTC subscriber yet — buffer it rather than dropping
            // it silently (see lib/signalBacklog.ts).
            console.warn(`matchmaking: webrtc: no listener yet — ${kind === "ice" ? "ice buffered" : `${kind} queued`}`, {
              roomId: message.roomId,
            })
            signalBacklog.current.push(message.roomId, message.data)
          }
          break
        }
        case "chat":
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          setPeerTyping(false)
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", content: message.content, ts: message.ts },
          ])
          break
        case "chat-sent": {
          const timer = pendingChatSendsRef.current.get(message.clientMessageId)
          if (timer) {
            clearTimeout(timer)
            pendingChatSendsRef.current.delete(message.clientMessageId)
          }
          // Deliberately not gated on isCurrentRoom — this account's own
          // send, being acknowledged; nothing to protect against here that
          // stale-room protection exists for (an incoming push from
          // someone else's room).
          console.debug("match-chat: delivered", { roomId: message.roomId })
          setMessages((prev) => prev.map((m) => (m.id === message.clientMessageId ? { ...m, status: "sent" } : m)))
          break
        }
        case "chat-failed": {
          const timer = pendingChatSendsRef.current.get(message.clientMessageId)
          if (timer) {
            clearTimeout(timer)
            pendingChatSendsRef.current.delete(message.clientMessageId)
          }
          console.debug("match-chat: rejected stale room", { roomId: message.roomId, reason: message.reason })
          setMessages((prev) => prev.map((m) => (m.id === message.clientMessageId ? { ...m, status: "failed" } : m)))
          break
        }
        case "friend-chat-message": {
          console.debug("friend-chat: live delivery", { friendshipId: message.friendshipId })
          setFriendMessages((prev) => {
            const next = new Map(prev)
            const existing = next.get(message.friendshipId) ?? []
            // A duplicate live push (defensive — the server already
            // avoids re-sending on a deduped retry) must never render the
            // same received message twice.
            if (existing.some((m) => m.id === message.message.id)) return prev
            next.set(message.friendshipId, [
              ...existing,
              { id: message.message.id, from: "peer", text: message.message.text, ts: message.message.createdAt },
            ])
            return next
          })
          break
        }
        case "friend-chat-sent": {
          const timer = pendingFriendChatSendsRef.current.get(message.clientMessageId)
          if (timer) {
            clearTimeout(timer)
            pendingFriendChatSendsRef.current.delete(message.clientMessageId)
          }
          console.debug("friend-chat: persisted", { friendshipId: message.friendshipId })
          setFriendMessages((prev) => {
            const existing = prev.get(message.friendshipId)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(
              message.friendshipId,
              existing.map((m) =>
                m.id === message.clientMessageId
                  ? { ...m, id: message.messageId, ts: message.createdAt, status: "sent" }
                  : m
              )
            )
            return next
          })
          break
        }
        case "friend-chat-error": {
          const timer = pendingFriendChatSendsRef.current.get(message.clientMessageId)
          if (timer) {
            clearTimeout(timer)
            pendingFriendChatSendsRef.current.delete(message.clientMessageId)
          }
          console.debug("friend-chat: send rejected", { friendshipId: message.friendshipId, reason: message.reason })
          setFriendMessages((prev) => {
            const existing = prev.get(message.friendshipId)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(
              message.friendshipId,
              existing.map((m) => (m.id === message.clientMessageId ? { ...m, status: "failed" } : m))
            )
            return next
          })
          break
        }
        case "mic-state":
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          setPeerMicEnabled(message.micEnabled)
          break
        case "typing":
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          setPeerTyping(true)
          clearTimeout(peerTypingTimeout.current)
          peerTypingTimeout.current = setTimeout(() => setPeerTyping(false), 3000)
          break
        case "peer-left": {
          if (!isCurrentRoom(roomRef.current, message.roomId)) break
          // Captured before setRoomId(null, ...) below, which clears
          // roomSourceRef.current as part of clearing the room itself —
          // see setRoomId's own doc comment.
          const endedRoomSource = roomSourceRef.current
          console.debug("matchmaking: peer-left", { roomId: message.roomId, source: endedRoomSource })
          recordHistory(peerRef.current)
          setRoomId(null, "peer_disconnected")
          setPeer(null)
          setPeerMicEnabled(true)
          setPeerTyping(false)
          if (endedRoomSource === "friend") {
            // Same reasoning as "room-setup-failed"'s own friend-call
            // branch above — a direct call's partner leaving must never
            // read as (or behave like) a random-match peer-left.
            setServerState((prev) => nextMatchState(prev, { type: "reset-idle" }))
            if (wantsMatchingRef.current) findMatch()
          } else {
            setServerState((prev) => nextMatchState(prev, { type: "peer-left-received" }))
          }
          break
        }
        case "rejected":
          console.warn("matchmaking: hello rejected", { reason: message.reason })
          if (message.reason === "invalid_ticket") {
            invalidTicketStreakRef.current += 1
            const streak = invalidTicketStreakRef.current
            if (streak < CONSECUTIVE_INVALID_TICKET_LIMIT) {
              // A single expired/invalid ticket is routine (2-minute TTL) —
              // mint a fresh one and try again right away.
              announce()
            } else {
              // This many in a row, with no successful "ready" in between,
              // stops looking like an expired ticket and starts looking
              // like every ticket is failing verification outright — see
              // AccountRestriction's "connection_failed" doc comment (the
              // leading suspect being REALTIME_TICKET_SECRET not matching
              // between wherever tickets are minted and wherever they're
              // verified). Surfaced explicitly instead of retrying forever
              // in a loop that would otherwise just exhaust the ticket
              // endpoint's own rate limit and then go silent.
              console.error("matchmaking: hello rejected as invalid_ticket repeatedly — backing off and surfacing this", {
                consecutiveRejections: streak,
              })
              setRestriction({ reason: "connection_failed" })
              setTimeout(() => {
                invalidTicketStreakRef.current = 0
                announce()
              }, CONNECTION_FAILED_RETRY_MS)
            }
          } else {
            setRestriction({ reason: message.reason })
          }
          break
        case "online-count":
          setOnlineCount(message.count)
          break
        case "blocked":
          console.log("matchmaking: blocked ack", { ok: message.ok })
          // Gated only on wantsMatching, not `ok` — the interaction already
          // ended locally, unconditionally, the instant block() was called
          // (see its own comment); whether the block itself persisted to
          // the database doesn't change whether the guest still wants a
          // fresh search, and this is what actually sends the "find" that
          // gets one going (mirroring skip(), which re-queues as part of
          // handling "skip" itself, server-side). Without this, a failed
          // addBlock() (a real DB error, not the common case) used to leave
          // the guest stuck on block()'s own optimistic queue-pending with
          // nothing ever sent to resolve it.
          if (wantsMatchingRef.current) findMatch()
          break
        case "unblocked":
          // The blocked-users list itself updates via the "friends-snapshot"
          // the server re-sends right after a successful unblock — this is
          // just for any UI feedback (e.g. clearing a "removing…" state) a
          // caller of unblockUser() wants to react to directly.
          console.log("matchmaking: unblock ack", { ok: message.ok })
          break
        case "error":
          console.error("matchmaking: server reported an error", {
            context: message.context,
            message: message.message,
          })
          // The "find"/"skip" we just sent failed server-side (see
          // server/ws-server.ts's catch around handleParsedMessage) — the
          // client already optimistically entered "queue-pending" and
          // nothing else will ever arrive to move it on its own (it can
          // never reach "searching" on its own either — see
          // lib/matchStateMachine.ts). Retry once the way "peer-left"
          // already does, but only if still actually waiting on this
          // attempt by the time this fires — the guest may have paused,
          // skipped, or navigated away in the meantime.
          if (message.context === "find") {
            setTimeout(() => {
              // "queue-pending", not (only) "searching" — a find that
              // errors server-side never reaches "queued" in the first
              // place, so it's still sitting in "queue-pending" (or, if a
              // second find/skip already superseded it, "searching" from
              // THAT attempt) when this fires. Retrying from "searching"
              // too is harmless — a fresh "find" while already queued just
              // re-queues under a new generation, same as any other.
              const current = serverStateRef.current
              if (current === "queue-pending" || current === "searching") findMatch()
            }, 2000)
          } else if (message.context === "hello") {
            // hello itself failed server-side before "ready" could be sent
            // (see server/ws-server.ts's catch around handleParsedMessage)
            // — nothing else is ever coming for this attempt. Re-announce
            // (fresh ticket + a fresh hello) after a short delay rather than
            // leaving the guest waiting on a "ready" that's never arriving;
            // announce() itself resets realtimeReady first, so this can't
            // race a "ready" that unexpectedly still shows up right after.
            setTimeout(() => announce(), 2000)
          }
          break
        case "match-invitations":
          setMatchInvitations(message.invitations)
          break
        case "match-invite-error":
          setMatchInviteError(message.message)
          break
        case "friends-snapshot": {
          setFriends(message.friends)
          if (accountId) {
            try {
              sessionStorage.setItem(friendsCacheKey(accountId), JSON.stringify(message.friends))
            } catch { /* Cache failure must never interrupt realtime updates. */ }
          }
          setFriendRequestsSent(message.requestsSent)
          setBlockedUsers(message.blocked)
          // Diff against the previous snapshot's received-request ids so
          // the live toast only ever fires for one that's genuinely new —
          // not on every routine snapshot refresh (e.g. after unrelated
          // friends actions) that happens to still include an
          // already-seen, still-pending request.
          const newIds = message.requestsReceived.map((r) => r.id)
          const newlyArrived = message.requestsReceived.find((r) => !previousReceivedIds.current.has(r.id))
          previousReceivedIds.current = new Set(newIds)
          setFriendRequestsReceived(message.requestsReceived)
          if (newlyArrived) setFriendToastRequestId(newlyArrived.id)
          break
        }
        case "friend-request-result": {
          if (message.result === "subscription_required") window.location.assign(subscriptionHref("friends"))
          const outcome: FriendRequestOutcome =
            message.result === "sent" || message.result === "already_requested"
              ? "requested"
              : message.result === "auto_accepted" || message.result === "already_friends"
                ? "friends"
                : "failed"
          setFriendActionState((prev) => {
            const next = new Map(prev)
            next.set(message.targetDisplayId, outcome)
            return next
          })
          break
        }
        default:
          break
      }
    })
  }, [subscribe, recordHistory, announce, findMatch, accountId, setRoomId])

  // Let the matched partner know our mic state — fires immediately once a
  // real room exists, and again on every toggle after that.
  useEffect(() => {
    if (!roomId) return
    send({ type: "mic-state", roomId, micEnabled })
  }, [roomId, micEnabled, send])

  // Per-"ready"-session guard for the reconnect-resume effect right below —
  // the "explicit per-ready generation" state that keeps it from
  // double-sending "find". `roomId` has to be in that effect's dependency
  // array (a genuine reconnect clears it, and the effect needs to react to
  // that), but `roomId` *also* legitimately goes to `null` for reasons that
  // already send their own follow-up request — an ordinary skip() (which
  // re-queues server-side as part of handling "skip" itself), a successful
  // block() (see the "blocked" case above), and the deliberately-delayed
  // "peer-left" auto-retry effect further down. Without this guard, any of
  // those would make the reconnect-resume effect fire *again* too, sending
  // a redundant second "find". Reset to false the moment `realtimeReady`
  // itself drops (a genuine disconnect) so the next time it becomes true is
  // treated as a fresh session worth resuming into; left `true` for the
  // rest of an already-ready session so any later `roomId` churn from
  // skip/block/peer-left is recognized as already handled.
  const resumedForCurrentReadyRef = useRef(false)

  // THE reconnect-resume fix: once a fresh "hello" is actually acknowledged
  // (`realtimeReady` — never the raw transport `connected`, and never
  // `serverState`, which is exactly what goes stale across a disconnect —
  // see the effect above), re-request a match if the guest still wants one
  // and doesn't currently have an active room. This is deliberately
  // independent of whatever `serverState`/`state` happened to be before the
  // disconnect — a stale "searching"/"queue-pending" works exactly the same
  // as "idle" here, which is the actual bug this fixes: a `findMatch()`
  // call gated on `state === "idle"` alone (like MatchStage's old
  // now-removed auto-start effect used to be) would leave a disconnect
  // that happened while genuinely searching (or mid-call) with nothing to
  // ever retry it.
  useEffect(() => {
    if (!realtimeReady) {
      resumedForCurrentReadyRef.current = false
      return
    }
    if (resumedForCurrentReadyRef.current) return
    resumedForCurrentReadyRef.current = true
    if (!canSearch(roomRef.current) || !wantsMatchingRef.current) return
    console.log("matchmaking: ready + still wants matching + no active room — sending find")
    findMatch()
  }, [realtimeReady, roomId, findMatch])

  // "peer-left" is a brief transitional state — automatically look for
  // someone new. Also gated on `realtimeReady`: a peer-left right as the
  // socket happens to reconnect (rare, but not impossible) would otherwise
  // send "find" into the same pre-"hello" gap the reconnect-resume effect
  // above guards against. If we're not ready when this would fire, skip
  // the timer entirely rather than sending into the gap — `realtimeReady` is in the
  // dependency array, so once the reconnect's "hello" is actually
  // acknowledged, this effect re-runs and (serverState still being
  // "peer-left") schedules the retry then instead.
  useEffect(() => {
    if (serverState !== "peer-left" || !realtimeReady) return
    const timer = setTimeout(findMatch, 900)
    return () => clearTimeout(timer)
  }, [serverState, realtimeReady, findMatch])

  // Bounded acknowledgement timeout — "queue-pending" means a "find"/
  // "skip"/block-resume was actually SENT, but neither "queued" nor
  // "matched" has confirmed it yet. If neither ever arrives (a dropped
  // frame, a silent server-side failure that doesn't even send "error", a
  // network blip that doesn't trip the socket's own reconnect), this is
  // what recovers — but only up to MAX_AUTOMATIC_QUEUE_PENDING_RETRIES (1):
  // one automatic retry per attempt, never an indefinite "find" every
  // QUEUE_PENDING_ACK_TIMEOUT_MS forever. Once that budget is spent, this
  // gives up and surfaces "error" instead — see decideQueuePendingTimeout's
  // own doc comment for the three-way decision this reads.
  //
  // `queuePendingAttempt` (not `serverState` alone) is the dependency
  // specifically so a SECOND entry into "queue-pending" (this very timeout
  // retrying via sendFind()) restarts the window even though `serverState`
  // itself didn't change value — see that state's own doc comment.
  useEffect(() => {
    if (roomRef.current || serverState !== "queue-pending") return
    const timer = setTimeout(() => {
      if (roomRef.current) return
      // Both `serverState` and `realtimeReady` closed over here are still
      // accurate at fire time, not stale — either one changing before this
      // fires re-runs this effect (they're both in the dependency array),
      // whose cleanup cancels this exact timer first. So if this callback
      // ever actually runs, `serverState` was still "queue-pending" and
      // `realtimeReady` was still whatever's closed over, right up to now.
      const decision = decideQueuePendingTimeout(queuePendingRetryCountRef.current, wantsMatchingRef.current, realtimeReady)
      if (decision === "do-nothing") return
      if (decision === "retry") {
        queuePendingRetryCountRef.current += 1
        console.warn(
          `matchmaking: queue-pending ack timeout — no queued/matched within ${QUEUE_PENDING_ACK_TIMEOUT_MS}ms, retrying find (${queuePendingRetryCountRef.current}/${MAX_AUTOMATIC_QUEUE_PENDING_RETRIES})`
        )
        // sendFind(), never findMatch() — this retry is what's SPENDING
        // the budget just incremented above; findMatch() would reset it
        // right back to 0 and this timeout would then retry forever,
        // exactly the bug this whole mechanism exists to prevent.
        sendFind()
        return
      }
      // "give-up" — the budget is spent and neither "queued" nor "matched"
      // ever arrived across MAX_AUTOMATIC_QUEUE_PENDING_RETRIES retries.
      // Stop retrying automatically; a real, visible error (StatusPill's
      // "error" state) is what recovers from here, via an explicit,
      // guest-initiated findMatch() (which resets this counter itself).
      console.error(
        `matchmaking: queue-pending ack timeout — automatic retry budget (${MAX_AUTOMATIC_QUEUE_PENDING_RETRIES}) exhausted, giving up and surfacing an error instead of retrying forever`
      )
      setServerState((prev) => nextMatchState(prev, { type: "queue-pending-exhausted" }))
    }, QUEUE_PENDING_ACK_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [serverState, queuePendingAttempt, realtimeReady, sendFind])

  // A media failure must not choose a different person. useWebRTC attempts
  // ICE recovery in this same room; the user can still explicitly skip.

  // Full teardown when realtime is disabled — sign-out, session expiry,
  // legal becoming invalid, an account switch, or plain unmount-adjacent
  // teardown (see `enabled`'s own doc comment above). Deliberately resets
  // EVERY piece of presentation state this hook owns, not just the
  // connection-related ones — a stale friends list, online count, or match
  // history-in-progress must never survive into whatever comes next (a
  // different signed-in account, or a fully signed-out screen). Placed last
  // (after every ref/state it touches has already been declared above) —
  // not just for readability, but because referencing them from an earlier
  // position defeats the React Compiler's ability to verify this hook's
  // other memoization is still correct.
  useEffect(() => {
    if (enabled) return
    console.log("matchmaking: realtime disabled — full teardown")
    wantsMatchingRef.current = false
    resumedForCurrentReadyRef.current = false
    invalidTicketStreakRef.current = 0
    profileRevisionRef.current = 0
    lastSentProfileRef.current = null
    signalBacklog.current.clearAll()
    // Best-effort courtesy only — useSignalingSocket's own effect (reacting
    // to this same `enabled` prop, and registered earlier in this hook's
    // body, so its effects run first within one React commit) may already
    // have closed the socket by the time this runs. The server's own close
    // handler (cleanUpAccount() in server/ws-server.ts) is what's actually
    // authoritative for tearing down this account's room/queue state
    // either way — this send is not load-bearing.
    send({ type: "leave" })
    // Reacting to an external system (`enabled` flipping off — sign-out,
    // session expiry, legal becoming invalid, an account switch) by
    // resetting this hook's entire presentation state, not mirroring
    // existing React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtimeReady(false)
    setServerState("idle")
    setRoomId(null, "realtime_disabled")
    setInitiator(false)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    setOnlineCount(null)
    setRestriction(null)
    // Keep the last friends snapshot through temporary realtime teardown.
    // Account changes/sign-out clear it separately above.
    setFriendRequestsReceived([])
    setFriendRequestsSent([])
    setBlockedUsers([])
    setFriendActionState(new Map())
    setFriendToastRequestId(null)
    previousReceivedIds.current = new Set()
  }, [enabled, send, setRoomId])

  return {
    connected,
    realtimeReady,
    // True once this account's connection attempt has confirmed a
    // genuinely different, still-active device/tab owns the realtime
    // connection right now (an OmeTV-style single-active-session policy —
    // see useSignalingSocket's own doc comment on `supersededElsewhere`).
    // `retryRealtimeConnection` is the explicit, person-initiated way out
    // — e.g. once the other device has actually gone idle/closed — never
    // retried automatically beyond the one bounded attempt already built
    // into the transport layer itself.
    activeOnAnotherDevice: supersededElsewhere,
    retryRealtimeConnection,
    state,
    // The current room id itself — SwipeStage.tsx threads this straight
    // through to the peer VideoTile, which tags its own
    // reportRemoteVideoPlaying() calls with it (see that function's own
    // doc comment for why). Not otherwise meant as a general-purpose
    // identifier for callers — `hasCurrentRoom`/`canMatchChat` below are
    // the derived values most callers actually want.
    roomId,
    reportRemoteVideoPlaying,
    // Chat availability — deliberately separate from `state`'s video
    // meaning; see canMatchChat's own doc comment above. `hasCurrentRoom`
    // is exposed too since a caller may want "is there a live room at
    // all" without the realtimeReady/peer conditions baked in.
    hasCurrentRoom,
    canMatchChat,
    onlineCount,
    peer,
    peerMicEnabled,
    peerTyping,
    remoteStream,
    messages,
    history,
    restriction,
    findMatch,
    leaveQueueOnly,
    skip,
    pauseMatching,
    sendChat,
    notifyTyping,
    report,
    block,
    unblockUser,
    // Friends — see the state block above for what each one actually traces back to.
    friends,
    friendRequestsReceived,
    matchInvitations,
    matchInviteError,
    inviteFriendToMatch,
    respondToMatchInvitation,
    friendRequestsSent,
    blockedUsers,
    friendActionState,
    friendToastRequestId,
    sendFriendRequestTo,
    respondToFriendRequest,
    unfriend,
    blockFriendAccount,
    dismissFriendToast,
    // Friend chat — see friendMessages' own doc comment above for what's
    // cache vs. authoritative here.
    friendMessages,
    sendFriendChatMessage,
    markFriendChatRead,
  }
}
