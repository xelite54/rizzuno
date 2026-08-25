"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSignalingSocket } from "./useSignalingSocket"
import { useWebRTC } from "./useWebRTC"
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

/** Per-displayId outcome of a friend request sent *this session* — not persisted client-side (there's nothing to persist: the server's friends-snapshot is the actual source of truth for confirmed friends/pending state; this is only for "I just clicked Add on this specific match/history row, what happened"). */
export type FriendRequestOutcome = "requested" | "friends" | "failed"

const STUCK_CONNECTION_GRACE_MS = 6000
const MAX_HISTORY = 30

export function useMatchmaking(
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
  const { connected, send, subscribe } = useSignalingSocket()

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
  const peerRef = useRef<PeerProfile | null>(null)
  useEffect(() => {
    peerRef.current = peer
  }, [peer])
  const recordHistory = useCallback((entry: PeerProfile | null) => {
    if (!entry) return
    setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
  }, [])
  const failedSince = useRef<number | null>(null)
  const signalListeners = useRef(new Set<(roomId: string, data: RtcSignal) => void>())
  const peerTypingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastTypingSentAt = useRef(0)

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
    setServerState("searching")
    send({ type: "find" })
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
    send({ type: "block", roomId })
    setRoomId(null)
    setPeer(null)
    setServerState("searching")
  }, [roomId, send, recordHistory])

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
    setRoomId(null)
    setPeer(null)
    setMessages([])
    setPeerMicEnabled(true)
    setPeerTyping(false)
    setServerState("paused")
    send({ type: "leave" })
  }, [send, recordHistory])

  // Mints a fresh, short-lived realtime ticket from the authenticated
  // session (see app/api/realtime/ticket) and announces this connection to
  // the server with it — never a bare self-declared id (spec: "never trust
  // a user ID supplied by the client without server verification"). Runs on
  // every (re)connect, and again whenever the guest's own username, gender,
  // or profile photo changes — so a match, current or future, can actually
  // see it (the server preserves any in-progress room across this
  // re-announce, it isn't treated as a fresh reconnect).
  const announce = useCallback(async () => {
    if (!myHandle) return
    try {
      const res = await fetch("/api/realtime/ticket")
      if (!res.ok) {
        const body: { error?: string; until?: number; reason?: string | null } = await res.json().catch(() => ({}))
        if (body.error === "banned") setRestriction({ reason: "banned", detail: body.reason })
        else if (body.error === "suspended") setRestriction({ reason: "suspended", until: body.until })
        else if (body.error === "account_deleted") setRestriction({ reason: "account_deleted" })
        else if (body.error === "acceptance_required") setRestriction({ reason: "acceptance_required" })
        return
      }
      const { ticket } = (await res.json()) as { ticket: string }
      setRestriction(null)
      send({
        type: "hello",
        ticket,
        handle: myHandle,
        username: myUsername || undefined,
        gender: myGender,
        profilePhoto: myProfilePhoto,
      })
    } catch {
      // Network hiccup minting the ticket — the socket's own reconnect will
      // trigger this again; nothing to announce this time around.
    }
  }, [myHandle, myUsername, myGender, myProfilePhoto, send])

  useEffect(() => {
    // Reacting to an external system (the socket just (re)connected) by
    // fetching a ticket and telling the server who we are — not mirroring
    // existing React state, so the setState calls inside announce() (on the
    // ticket response) are the intended outcome here, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) announce()
  }, [connected, announce])

  useEffect(() => {
    return subscribe((message: ServerMessage) => {
      switch (message.type) {
        case "queued":
          setServerState((prev) => (prev === "peer-left" ? prev : "searching"))
          break
        case "matched":
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
        case "signal":
          signalListeners.current.forEach((listener) => listener(message.roomId, message.data))
          break
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
          if (message.reason === "invalid_ticket") {
            // Ticket expired/invalid — mint a fresh one and try again right away.
            announce()
          } else {
            setRestriction({ reason: message.reason })
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
  }, [subscribe, recordHistory, announce])

  // Let the matched partner know our mic state — fires immediately once a
  // real room exists, and again on every toggle after that.
  useEffect(() => {
    if (!roomId) return
    send({ type: "mic-state", roomId, micEnabled })
  }, [roomId, micEnabled, send])

  // "peer-left" is a brief transitional state — automatically look for someone new.
  useEffect(() => {
    if (serverState !== "peer-left") return
    const timer = setTimeout(findMatch, 900)
    return () => clearTimeout(timer)
  }, [serverState, findMatch])

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

  return {
    connected,
    state,
    peer,
    peerMicEnabled,
    peerTyping,
    remoteStream,
    messages,
    history,
    restriction,
    findMatch,
    skip,
    pauseMatching,
    sendChat,
    notifyTyping,
    report,
    block,
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
