"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSignalingSocket } from "./useSignalingSocket"
import { useWebRTC } from "./useWebRTC"
import { SignalBacklog } from "@/lib/signalBacklog"
import type {
  ChatContent,
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

export type MatchState = "idle" | "searching" | "connecting" | "active" | "peer-left" | "paused"
export type ChatMessage = { id: string; from: "me" | "peer"; content: ChatContent; ts: number }

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
   * visible to the person staring at "Getting ready…".
   */
  | { reason: "connection_failed" }

/** Per-displayId outcome of a friend request sent *this session* — not persisted client-side (there's nothing to persist: the server's friends-snapshot is the actual source of truth for confirmed friends/pending state; this is only for "I just clicked Add on this specific match/history row, what happened"). */
export type FriendRequestOutcome = "requested" | "friends" | "failed"

const STUCK_CONNECTION_GRACE_MS = 6000
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
  myProfilePhoto?: string | null
) {
  const { connected, send, subscribe } = useSignalingSocket(enabled)

  // `connected` only means the WebSocket transport opened — it says nothing
  // about whether the realtime server has actually verified our ticket and
  // finished processing "hello" yet (that's a real await chain server-side:
  // getUserStatus(), etc). Matching on `connected` alone let the client fire
  // "find" before the server had any ConnectionState for this socket, which
  // server/ws-server.ts silently drops (`if (!state) return`) — the guest
  // would then sit in "searching" forever with nothing left to retry it.
  // `realtimeReady` instead only ever flips true when the server's own
  // "ready" ack (sent right after "hello" is fully processed — see
  // server/ws-server.ts) comes back, and flips false again on every
  // disconnect and every fresh "hello" attempt, so it never gets ahead of
  // what the server actually has registered for us.
  const [realtimeReady, setRealtimeReady] = useState(false)

  // `serverState` tracks what the signaling server has told us (queued,
  // matched, peer left). Whether the call is actually "active" is a
  // derived read of the live WebRTC connection, not a copy of it — see
  // `state` below.
  const [serverState, setServerState] = useState<MatchState>("idle")
  const [roomId, setRoomId] = useState<string | null>(null)
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

  // Whether the guest currently *wants* automatic matching to be happening
  // — the "desired intent" this whole reconnect fix hinges on, kept
  // deliberately separate from `serverState` (which only reflects what the
  // server last actually told us, and goes stale the instant the socket
  // drops — see the effect below). Starts false: nothing auto-starts until
  // MatchStage's own onboarding-gated effect calls findMatch() for the
  // first time. From then on, findMatch() (called directly, by skip, the
  // peer-left auto-retry, or a successful block) sets it true;
  // pauseMatching() and the full teardown effect are the only things that
  // set it back to false.
  //
  // A ref, not state, on purpose: it's read by the reconnect-resume effect
  // further down, and if it were state, flipping it inside findMatch()
  // would itself be a dependency change that re-triggers that same effect
  // a second time — double-sending "find" the moment MatchStage's own
  // auto-start effect calls findMatch() directly (realtimeReady/roomId
  // wouldn't have changed, only this). A ref sidesteps that: writing to it
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
  // `serverState` is only forced to "searching" here if we actually had a
  // room to lose (an idle/already-searching guest has no room, and
  // "searching" is already the right thing to keep showing through a brief
  // reconnect gap) and only if the guest still wants matching — if they'd
  // paused, pauseMatching() already cleared the room itself before this
  // could ever run.
  useEffect(() => {
    if (connected) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtimeReady(false)
    if (!roomId) return
    console.log("matchmaking: transport dropped mid-room — treating the room as lost, not assuming it survived")
    recordHistory(peerRef.current)
    setRoomId(null)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    if (wantsMatchingRef.current) setServerState("searching")
  }, [connected, roomId, recordHistory])

  const failedSince = useRef<number | null>(null)
  const signalListeners = useRef(new Set<(roomId: string, data: RtcSignal) => void>())
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

  const onSignal = useCallback((handler: (roomId: string, data: RtcSignal) => void) => {
    signalListeners.current.add(handler)
    // Replay anything that arrived before this subscription existed, in
    // order. The handler filters by its own roomId internally (see
    // useWebRTC), so replaying entries for a room this particular handler
    // doesn't care about is a harmless no-op for it.
    console.log("webrtc: room initialized — flushing any buffered signals")
    signalBacklog.current.drainAll(handler)
    return () => {
      signalListeners.current.delete(handler)
    }
  }, [])

  const { remoteStream, status: rtcStatus } = useWebRTC({
    roomId,
    initiator,
    videoTrack,
    audioTrack,
    sendSignal,
    onSignal,
  })

  // The connection is genuinely "active" once WebRTC media is actually flowing.
  const state: MatchState = rtcStatus === "connected" ? "active" : serverState

  const findMatch = useCallback(() => {
    console.log("matchmaking: sending find")
    wantsMatchingRef.current = true
    setServerState("searching")
    send({ type: "find" })
  }, [send])

  // Leaves the real server-side queue WITHOUT touching `wantsMatching` or
  // showing "paused" — used when something external and temporary makes
  // matching impossible right now (e.g. the camera turning off mid-search;
  // see MatchStage.tsx's camera-controls-queue-membership effect), where
  // the guest hasn't actually changed their mind about wanting to match.
  // `serverState` goes back to "idle" specifically so StatusPill's existing
  // camera-aware copy ("Turn on your camera to start matching") is what
  // shows, instead of "Finding someone…" over a queue entry that doesn't
  // actually exist server-side anymore.
  const leaveQueueOnly = useCallback(() => {
    console.log("matchmaking: leaving queue only (not a pause — wantsMatching stays true)")
    send({ type: "leave" })
    setServerState((prev) => (prev === "searching" ? "idle" : prev))
  }, [send])

  const skip = useCallback(() => {
    recordHistory(peerRef.current)
    setRoomId(null)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    setServerState("searching")
    send({ type: "skip" })
  }, [send, recordHistory])

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 500)
      if (!trimmed || !roomId) return
      send({ type: "chat", roomId, content: { kind: "text", text: trimmed } })
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), from: "me", content: { kind: "text", text: trimmed }, ts: Date.now() },
      ])
    },
    [roomId, send]
  )

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
    // actually confirms it (including re-starting the search).
    send({ type: "block", roomId })
    setRoomId(null)
    setPeer(null)
    setServerState("searching")
  }, [roomId, send, recordHistory])

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
    setRoomId(null)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    setServerState("paused")
    send({ type: "leave" })
  }, [send, recordHistory])

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
          break
        case "queued":
          console.log("matchmaking: queued")
          setServerState((prev) => (prev === "peer-left" ? prev : "searching"))
          break
        case "matched":
          console.log("matchmaking: matched", { roomId: message.roomId, initiator: message.initiator })
          setRoomId(message.roomId)
          setInitiator(message.initiator)
          setPeer(message.peer)
          setMessages([])
          setPeerMicEnabled(true) // unknown until they tell us — assume on until we hear otherwise
          setPeerTyping(false)
          failedSince.current = null
          setServerState("connecting")
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
          // The partner edited their own profile mid-call — merge the
          // refreshed identity into the peer we already have.
          setPeer((prev) => (prev ? { ...prev, ...message.peer } : prev))
          break
        case "signal": {
          const kind = message.data.kind
          const label =
            kind === "offer" ? "webrtc: offer received" : kind === "answer" ? "webrtc: answer received" : "webrtc: ice received"
          console.log(`matchmaking: ${label}`, { roomId: message.roomId })
          if (signalListeners.current.size > 0) {
            signalListeners.current.forEach((listener) => listener(message.roomId, message.data))
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
          setPeerTyping(false)
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", content: message.content, ts: message.ts },
          ])
          break
        case "mic-state":
          setPeerMicEnabled(message.micEnabled)
          break
        case "typing":
          setPeerTyping(true)
          clearTimeout(peerTypingTimeout.current)
          peerTypingTimeout.current = setTimeout(() => setPeerTyping(false), 3000)
          break
        case "peer-left":
          recordHistory(peerRef.current)
          setRoomId(null)
          setPeer(null)
          setPeerMicEnabled(true)
          setPeerTyping(false)
          setServerState("peer-left")
          break
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
          if (message.ok && wantsMatchingRef.current) {
            // The interaction already ended locally the instant block() was
            // called — this is what actually gets a fresh search going
            // again, mirroring skip() (which re-queues as part of handling
            // "skip" itself, server-side) instead of leaving the guest
            // stuck showing "searching" with nothing actually re-queued.
            findMatch()
          }
          break
        case "unblocked":
          // The blocked-users list itself updates via the "friends-snapshot"
          // the server re-sends right after a successful unblock — this is
          // just for any UI feedback (e.g. clearing a "removing…" state) a
          // caller of unblockUser() wants to react to directly.
          console.log("matchmaking: unblock ack", { ok: message.ok, targetUserId: message.targetUserId })
          break
        case "error":
          console.error("matchmaking: server reported an error", {
            context: message.context,
            message: message.message,
          })
          // The "find"/"skip" we just sent failed server-side (see
          // server/ws-server.ts's catch around handleParsedMessage) — the
          // client already optimistically flipped to "searching" and
          // nothing else will ever arrive to move it on its own. Retry once
          // the way "peer-left" already does, but only if still actually
          // searching by the time this fires — the guest may have paused,
          // skipped, or navigated away in the meantime.
          if (message.context === "find") {
            setTimeout(() => {
              if (serverStateRef.current === "searching") findMatch()
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
        case "friends-snapshot": {
          setFriends(message.friends)
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
          const outcome: FriendRequestOutcome =
            message.result === "sent"
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
  }, [subscribe, recordHistory, announce, findMatch])

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
  // disconnect — a stale "searching" works exactly the same as "idle" here,
  // which is the actual bug this fixes: MatchStage's own auto-start effect
  // only ever fires from `state === "idle"`, so a disconnect that happened
  // while genuinely searching (or mid-call) left nothing to ever retry it.
  useEffect(() => {
    if (!realtimeReady) {
      resumedForCurrentReadyRef.current = false
      return
    }
    if (resumedForCurrentReadyRef.current) return
    resumedForCurrentReadyRef.current = true
    if (roomId || !wantsMatchingRef.current) return
    console.log("matchmaking: ready + still wants matching + no active room — sending find")
    findMatch()
  }, [realtimeReady, roomId, findMatch])

  // "peer-left" is a brief transitional state — automatically look for
  // someone new. Also gated on `realtimeReady`: a peer-left right as the
  // socket happens to reconnect (rare, but not impossible) would otherwise
  // send "find" into the same pre-"hello" gap the initial auto-start effect
  // guards against. If we're not ready when this would fire, skip the timer
  // entirely rather than sending into the gap — `realtimeReady` is in the
  // dependency array, so once the reconnect's "hello" is actually
  // acknowledged, this effect re-runs and (serverState still being
  // "peer-left") schedules the retry then instead.
  useEffect(() => {
    if (serverState !== "peer-left" || !realtimeReady) return
    const timer = setTimeout(findMatch, 900)
    return () => clearTimeout(timer)
  }, [serverState, realtimeReady, findMatch])

  // Track how long a connection has been stuck in "failed" (a ref, not state).
  useEffect(() => {
    if (rtcStatus === "connected") {
      failedSince.current = null
    } else if (rtcStatus === "failed" && !failedSince.current) {
      failedSince.current = Date.now()
    }
  }, [rtcStatus])

  // If a connection stays failed too long even after an ICE restart, give up gracefully (spec §55).
  useEffect(() => {
    if (rtcStatus !== "failed") return
    const timer = setTimeout(() => {
      if (failedSince.current) skip()
    }, STUCK_CONNECTION_GRACE_MS)
    return () => clearTimeout(timer)
  }, [rtcStatus, skip])

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
    setRoomId(null)
    setInitiator(false)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    setOnlineCount(null)
    setRestriction(null)
    setFriends([])
    setFriendRequestsReceived([])
    setFriendRequestsSent([])
    setBlockedUsers([])
    setFriendActionState(new Map())
    setFriendToastRequestId(null)
    previousReceivedIds.current = new Set()
  }, [enabled, send])

  return {
    connected,
    realtimeReady,
    state,
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
    friendRequestsSent,
    blockedUsers,
    friendActionState,
    friendToastRequestId,
    sendFriendRequestTo,
    respondToFriendRequest,
    unfriend,
    blockFriendAccount,
    dismissFriendToast,
  }
}
