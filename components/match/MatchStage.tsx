"use client"
import { useRealtimeAccount } from "@/hooks/useRealtimeAccount"
import { retainRealtime } from "@/lib/realtimeLifecycle"

import { useEffect, useRef, useState } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { motion, useReducedMotion } from "motion/react"
import { useLocalMedia } from "@/hooks/useLocalMedia"
import { useMatchmaking } from "@/hooks/useMatchmaking"
import { useMyProfile } from "@/hooks/useMyProfile"
import { SwipeStage } from "./SwipeStage"
import { SelfPanel } from "./SelfPanel"
import { CompactChat } from "./CompactChat"
import { SafetyMenu } from "./SafetyMenu"
import { ProfileMenu } from "./ProfileMenu"
import { ControlBar } from "./ControlBar"
import { FriendsPanel } from "./FriendsPanel"
import { IncomingFriendRequestToast } from "./IncomingFriendRequestToast"
import { IncomingMatchInvitationToast } from "./IncomingMatchInvitationToast"
import { RequestProfileSheet } from "./RequestProfileSheet"
import { SignInLanding } from "./SignInLanding"
import { AgeGate } from "./AgeGate"
import { LegalStatusError } from "./LegalStatusError"
import { AccountRestricted } from "./AccountRestricted"
import { ChooseUsername } from "./ChooseUsername"
import { ChooseGender } from "./ChooseGender"
import { PeerProfileSheet } from "./PeerProfileSheet"
import { ActiveOnAnotherDevice } from "./ActiveOnAnotherDevice"
import { MatchChatPanel } from "./MatchChatPanel"
import { MyProfileSheet } from "./MyProfileSheet"
import type { FriendState } from "./FriendButton"
import type { DemoFriend, PendingRequest, BlockedUser } from "@/hooks/useFriends"
import { useLegalAcceptance } from "@/hooks/useLegalAcceptance"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"
import { UsersIcon } from "@/components/icons"
import { EASE_OUT } from "@/lib/motion"

// Auth.js redirects failed/cancelled Google sign-ins back to "/" (see
// auth.ts's `pages` config) with one of these codes in `?error=` — mapped
// here to something a person can actually read, since Auth.js's own
// generic error page is never shown.
function describeAuthError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "Sign-in was cancelled."
    case "Configuration":
      return "Google sign-in isn't configured correctly yet."
    default:
      return "Something went wrong signing in — try again."
  }
}

// A plain `signIn("google", { callbackUrl: "/" })` navigates this entire tab
// away to Google and back — a real page unload, which is why the camera/mic
// permission granted on the pre-login screen looked like it was being asked
// for again after signing in: the whole app (including useLocalMedia's live
// stream) had actually been torn down and recreated from scratch. Running
// the Google OAuth round trip inside a named popup instead means this tab —
// and its already-granted camera stream — never unloads at all; only the
// popup navigates. `window.name` (not React/component state) is what marks
// a window as "the sign-in popup", because it's the one thing that survives
// that window's own multiple cross-origin navigations (accounts.google.com,
// then back to this app) — everything else about that window's JS state is
// reset by each of those navigations.
const SIGNIN_POPUP_NAME = "rizzuno-google-signin"
const SIGNIN_POPUP_FEATURES = "width=480,height=680"
// A same-origin BroadcastChannel, not `window.opener.postMessage` — Google's
// own accounts.google.com pages are documented to send
// `Cross-Origin-Opener-Policy: same-origin`, which severs the popup's
// `window.opener` reference partway through the redirect the moment it
// navigates there. BroadcastChannel doesn't depend on that reference at all
// (same-origin pub/sub, keyed by name only), so it keeps working regardless.
const SIGNIN_CHANNEL_NAME = "rizzuno-auth"
type SignInPopupMessage = { ok: true } | { error: string }

export function MatchStage() {
  const reduceMotion = useReducedMotion()
  const { localStream, videoTrack, audioTrack, status, micEnabled, toggleMic } =
    useLocalMedia()

  // Guards the self-camera's home-screen grow/shrink layout animation
  // (see the motion.div below, keyed on `useHomeSplit`) against replaying
  // itself for reasons that have nothing to do with the guest actually
  // leaving/returning to the home screen on purpose. Coming back to this
  // tab after it was backgrounded can produce a brief, spurious flicker in
  // derived state — e.g. a WebSocket reconnect settling right as focus
  // returns — and without this, that flicker alone was enough to replay
  // the "leaving home" shrink-then-grow-back transition even though the
  // guest never swiped or did anything. Suppressing layout animation for
  // a short window right after regaining visibility means whatever the
  // correct state actually is just appears, instead of visibly animating
  // to it and back.
  const [suppressHomeLayoutAnimation, setSuppressHomeLayoutAnimation] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return
      setSuppressHomeLayoutAnimation(true)
      clearTimeout(timer)
      timer = setTimeout(() => setSuppressHomeLayoutAnimation(false), 600)
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearTimeout(timer)
    }
  }, [])

  // Lifted up here (not owned by MyProfileSheet) because a real match needs
  // to see this guest's username too — useMatchmaking hands it to the server.
  const myProfile = useMyProfile()

  // Nothing works until the guest signs in with the real Google OAuth
  // session (see auth.ts). "loading" covers the brief moment right after a
  // refresh where Auth.js is still checking for an existing session cookie
  // — treated as neither signed in nor signed out, so the landing screen
  // doesn't flash on and off for people who are actually already signed in.
  const { data: session, status: sessionStatus, update: updateSession } = useSession()
  // Session refresh may briefly report loading while retaining the same
  // authenticated account. Do not tear down its call during that refresh.
  const realtimeAccount = useRealtimeAccount(session?.user?.id, sessionStatus)
  const signedIn = Boolean(realtimeAccount)
  const authLoading = sessionStatus === "loading" && !signedIn

  // 18+ affirmation + Terms/Privacy acceptance, recorded server-side against
  // the signed-in account (see hooks/useLegalAcceptance.ts) — required
  // before matchmaking the same way choosing a username/gender is.
  // `updateSession` lets the hook revalidate a possibly-stale session once
  // if its own status check ever comes back 401 despite `signedIn` here
  // still reading true.
  const legal = useLegalAcceptance(signedIn, updateSession, realtimeAccount)
  const legalAccepted = legal.status === "accepted"

  // Choosing a username, then a gender, is required right after signing in,
  // before matching starts — both are how a real match will actually see you.
  const hasUsername = myProfile.username.trim().length > 0
  const hasGender = myProfile.gender !== null
  const onboarded = hasUsername && hasGender

  // AUTHENTICATION MUST OWN THE REALTIME LIFECYCLE — realtime (the
  // WebSocket connection itself, not just matchmaking on top of it) only
  // ever exists once every one of these is true. This used to be implicit:
  // the socket connected unconditionally the moment this component
  // mounted, regardless of sign-in/legal/onboarding status, which had two
  // real consequences — a not-yet-legally-accepted guest's ticket request
  // could come back `acceptance_required` and get misread as
  // AccountRestricted ("terms changed, sign out and back in") instead of
  // correctly showing AgeGate below; and a not-yet-onboarded guest's socket
  // existed (and consumed a slot in the online count) well before there was
  // any username/gender to actually match with. Passed into useMatchmaking
  // as `enabled` — see its own doc comment for everything that resets the
  // instant this goes false (sign-out, session expiry, legal becoming
  // invalid, an account switch, or teardown).
  const [admittedAccount, setAdmittedAccount] = useState<string | undefined>(undefined)
  const realtimeEnabled = retainRealtime(admittedAccount, realtimeAccount, legal.status, myProfile.profileHydrated, onboarded)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdmittedAccount(realtimeEnabled ? realtimeAccount : undefined)
  }, [realtimeEnabled, realtimeAccount])

  // Diagnostic only — `realtimeEnabled` is useSignalingSocket's `enabled`
  // input verbatim (see useMatchmaking() below), so every time it actually
  // FLIPS, that hook tears down and recreates the whole realtime
  // connection (see its own "effect started"/"reason: enabled_changed"
  // log). This traces WHICH of its three real inputs changed value at the
  // moment of a flip — legal status, profile hydration, or onboarding —
  // rather than leaving that to be inferred after the fact from
  // useSignalingSocket's logs alone.
  const realtimeEnabledLogRef = useRef({ enabled: realtimeEnabled, legalStatus: legal.status, hydrated: myProfile.profileHydrated, onboarded })
  useEffect(() => {
    const prev = realtimeEnabledLogRef.current
    if (prev.enabled !== realtimeEnabled) {
      console.debug("realtimeEnabled: flipped", {
        enabled: realtimeEnabled,
        legalStatusChanged: prev.legalStatus !== legal.status,
        hydratedChanged: prev.hydrated !== myProfile.profileHydrated,
        onboardedChanged: prev.onboarded !== onboarded,
        legalStatus: legal.status,
        hydrated: myProfile.profileHydrated,
        onboarded,
      })
    }
    realtimeEnabledLogRef.current = { enabled: realtimeEnabled, legalStatus: legal.status, hydrated: myProfile.profileHydrated, onboarded }
  }, [realtimeEnabled, legal.status, myProfile.profileHydrated, onboarded])

  const {
    realtimeReady,
    activeOnAnotherDevice,
    retryRealtimeConnection,
    state,
    roomId,
    reportRemoteVideoPlaying,
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
    friends: rawFriends,
    friendRequestsReceived: rawFriendRequestsReceived,
    blockedUsers: rawBlockedUsers,
    friendActionState,
    friendToastRequestId,
    sendFriendRequestTo,
    respondToFriendRequest,
    unfriend,
    blockFriendAccount,
    reportUser,
    dismissFriendToast,
    matchInvitations,
    matchInviteError,
    inviteFriendToMatch,
    respondToMatchInvitation,
    friendMessages,
    sendFriendChatMessage,
    markFriendChatRead,
    peerFriendTyping,
    notifyFriendTyping,
  } = useMatchmaking(
    realtimeEnabled,
    videoTrack,
    audioTrack,
    micEnabled,
    myProfile.handle,
    myProfile.username,
    myProfile.gender ?? undefined,
    myProfile.profilePhoto,
    realtimeAccount
  )

  // Auth.js lands a failed/cancelled Google sign-in back on this page with
  // `?error=...` — read it once, show it, then scrub it from the URL so a
  // refresh doesn't keep re-showing a stale error. Still needed for the
  // fallback path below (a plain full-page redirect, used when the popup
  // approach isn't available) — a sign-in that happened inside the popup
  // reports its error via postMessage instead (see the listener further
  // down), never through this tab's own URL.
  const [authError, setAuthError] = useState<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get("error")
    if (!error) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a one-time value off the URL, not mirroring existing state
    setAuthError(describeAuthError(error))
    params.delete("error")
    const rest = params.toString()
    window.history.replaceState({}, "", rest ? `?${rest}` : window.location.pathname)
  }, [])

  // If *this* window is the named sign-in popup (see SIGNIN_POPUP_NAME —
  // `window.name` is what survives that window's own navigations through
  // Google and back, unlike `window.opener`, which Google's own redirect can
  // sever — see the note above), report the outcome to whichever tab opened
  // it and close — the popup's own UI is never meant to be seen once
  // Google's redirect lands it back here. The opener's `useSession`
  // refetches automatically once the popup closes and focus returns to it
  // anyway (next-auth's default `refetchOnWindowFocus`), but broadcasting
  // the result explicitly (handled below) makes that update immediate
  // instead of waiting on a focus event, and is the only way an *error*
  // gets back to the opener at all, since this tab's own URL is where
  // Auth.js put it. `window.close()` itself is attempted regardless of
  // whether BroadcastChannel exists — a script closing a window it opened
  // isn't governed by COOP the way `window.opener` access is.
  useEffect(() => {
    if (typeof window === "undefined" || window.name !== SIGNIN_POPUP_NAME) return
    const params = new URLSearchParams(window.location.search)
    const error = params.get("error")
    if (!error && !signedIn) return

    const message: SignInPopupMessage = error ? { error } : { ok: true }
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SIGNIN_CHANNEL_NAME)
      channel.postMessage(message)
      channel.close()
    }
    try {
      window.close()
    } catch {
      // Some browsers refuse to close a window under certain conditions —
      // sign-in already succeeded either way; a leftover popup is cosmetic.
    }
  }, [signedIn])

  // The opener side of the same handshake, listening on the same channel —
  // deliberately not a `message` event / `window.opener` listener, for the
  // same COOP reason noted above.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(SIGNIN_CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<SignInPopupMessage>) => {
      if ("ok" in event.data && event.data.ok) {
        updateSession()
      } else if ("error" in event.data && event.data.error) {
        setAuthError(describeAuthError(event.data.error))
      }
    }
    return () => channel.close()
  }, [updateSession])

  // Opens the popup synchronously (inside the click handler, before any
  // `await`) so browsers' popup blockers — which only allow window.open
  // during a direct user gesture — don't block it, then points it at
  // Google's actual authorization URL once signIn's own CSRF round trip
  // resolves it. Falls back to the previous full-tab redirect if the popup
  // couldn't be opened (blocked, or a browser/context that doesn't support
  // it) so sign-in still works everywhere — it just won't preserve the
  // camera stream in that fallback case.
  async function handleGoogleSignIn() {
    const popup =
      typeof window !== "undefined"
        ? window.open("about:blank", SIGNIN_POPUP_NAME, SIGNIN_POPUP_FEATURES)
        : null

    if (!popup || popup.closed) {
      await signIn("google", { callbackUrl: "/" })
      return
    }

    popup.focus()
    const res = await signIn("google", { redirect: false, callbackUrl: "/" })
    if (res.url) {
      popup.location.href = res.url
    } else {
      popup.close()
      setAuthError(describeAuthError(res.error ?? ""))
    }
  }

  // Require a real capture track, including after permission/device failure.
  const cameraUnavailable = !videoTrack

  // Deliberately NOT auto-started. A first visit (or a refresh) lands in
  // "idle" and stays there — SwipeStage/StatusPill show the same calm
  // signed-in home treatment idle shares with a deliberate pause (see
  // StatusPill.tsx's own doc comment on why "idle" and "paused" render
  // identically there now) until the guest actually swipes. That swipe is
  // just findMatch() (see SwipeStage's onResume, wired below) — the
  // matchmaking state machine already treats "find-sent" as valid from any
  // state, "idle" included (see lib/matchStateMachine.ts), so there's
  // nothing else here to wire up for that first search to work correctly.
  //
  // Reconnect-resume (a disconnect mid-search or mid-call re-finding
  // automatically once realtime comes back) is unaffected by any of this —
  // that's useMatchmaking.ts's own responsibility, driven by its
  // `wantsMatchingRef` (which only ever becomes true once the guest has
  // actually swiped at least once), not by anything in this file.

  // Preserve queue safety if capture becomes unavailable. Restoring a
  // device resumes an existing search intent, never a fresh homepage visit.
  const leftQueueForUnavailableCamera = useRef(false)
  useEffect(() => {
    if (cameraUnavailable) {
      // Either stage counts — "queue-pending" (find/skip sent, not yet
      // confirmed) is just as real a queue attempt as "searching" (confirmed
      // via "queued") from the camera's point of view; both need leaving.
      if ((state === "searching" || state === "queue-pending") && !leftQueueForUnavailableCamera.current) {
        leftQueueForUnavailableCamera.current = true
        console.log("matchmaking: camera unavailable while searching — leaving the real queue")
        leaveQueueOnly()
      }
      return
    }
    if (leftQueueForUnavailableCamera.current) {
      leftQueueForUnavailableCamera.current = false
      if (realtimeReady && !restriction) {
        console.log("matchmaking: camera available again — sending exactly one fresh find")
        findMatch()
      }
    }
  }, [cameraUnavailable, state, realtimeReady, restriction, findMatch, leaveQueueOnly])

  // A swipe skips immediately — no undo grace period.
  function handleSwipeComplete() {
    skip()
  }

  const displayedPeer = peer
  // `state` prefers "active" over serverState for as long as WebRTC still
  // reports connected (see useMatchmaking.ts's `state` derivation) — right
  // after skip() clears the peer, there's a brief gap where `state` still
  // reads "active" with no peer to show, before WebRTC itself catches up
  // and reports disconnected. Mapping "active with no peer" to
  // "queue-pending" closes that gap — genuinely accurate, not just a
  // presentational patch: the real serverState already IS "queue-pending"
  // at that exact moment, `state` just hasn't caught up to it yet.
  const swipeMatchState = state === "active" && !peer ? "queue-pending" : state
  const hasMatchedPeer = Boolean(roomId && peer)
  // Chat availability is independent of `state`'s video meaning — see
  // useMatchmaking's `canMatchChat` doc comment for why. A server-confirmed
  // match already has a valid peer relationship before WebRTC video
  // finishes connecting; chat has no reason to wait for decoded frames.
  const canChat = canMatchChat
  // This is the signed-in home screen, not half of the call layout.
  // While it is visible the stage owns the whole canvas and the self camera
  // becomes a small preview. Starting a search restores the two-person call
  // layout immediately, ready for the incoming match.
  const onHomeScreen =
    signedIn &&
    legalAccepted &&
    onboarded &&
    !restriction &&
    !cameraUnavailable &&
    (swipeMatchState === "idle" || swipeMatchState === "paused")

  // Keep the structural home split independent from async session/profile/
  // camera hydration. Matchmaking state is idle on the first render, so a
  // returning guest now begins at 42/58 instead of rendering one 50/50 frame
  // while those other values settle. Only an actual matching state is
  // allowed to animate the shell from 42/58 to 50/50.
  const useHomeSplit =
    (authLoading || signedIn) &&
    (swipeMatchState === "idle" || swipeMatchState === "paused")
  const animateIntoMatching =
    signedIn &&
    !useHomeSplit &&
    (swipeMatchState === "queue-pending" ||
      swipeMatchState === "searching" ||
      swipeMatchState === "connecting" ||
      swipeMatchState === "active" ||
      swipeMatchState === "peer-left")

  // Friends + friend requests — real data now (see useMatchmaking.ts, which
  // owns the one WebSocket connection this all rides on, and
  // server/ws-server.ts + lib/db.ts for the actual persisted backend).
  // Mapped here into the same shapes FriendsPanel.tsx and friends already
  // expected (see hooks/useFriends.ts) so those components needed close to
  // no changes for what's underneath them to stop being fake.
  // `displayName` is just `username`, shown — not a separate identity with
  // its own fallback. It used to fall back to the invented "Someone" while
  // the `username` field right next to it (same source value) fell back to
  // "" — two different fake answers for the exact same missing data.
  // Consolidated on the one honest fallback: empty, never a fabricated
  // name. In practice this basically never triggers — onboarding requires
  // a username before matching works at all — see ChooseUsername.tsx.
  const friends: DemoFriend[] = rawFriends.map((f) => ({
    id: f.id,
    userId: f.userId,
    displayName: f.username ?? "",
    username: f.username ?? "",
    profilePhoto: f.profilePhoto,
    online: f.online,
    unreadCount: f.unreadCount,
  }))
  const requests: PendingRequest[] = rawFriendRequestsReceived.map((r) => ({
    id: r.id,
    senderId: r.senderId,
    displayName: r.username ?? "",
    username: r.username ?? "",
  }))
  const blockedUsers: BlockedUser[] = rawBlockedUsers.map((b) => ({
    id: b.userId,
    displayName: b.username ?? "",
  }))

  const [unreadMessages, setUnreadMessages] = useState(0)
  const friendsNotifications = requests.length + unreadMessages + matchInvitations.filter((invite) => invite.direction === "incoming").length
  const toastRequest = requests.find((request) => request.id === friendToastRequestId) ?? null
  // Set when "View profile" is tapped on the live toast — shows the request's
  // full-screen profile (Decline/Accept) directly, separate from opening the
  // whole Friends panel. Captured as its own value (not derived from the
  // toast's own state) so the toast's independent auto-dismiss timer can't
  // yank this away mid-read.
  const [viewingToastRequest, setViewingToastRequest] = useState<PendingRequest | null>(null)

  const [friendsOpen, setFriendsOpen] = useState(false)

  // Friend status for the *current match* — derived from
  // useMatchmaking's friendActionState, keyed by the peer's displayId (see
  // "friend-request" in lib/signaling/protocol.ts for why that's the only
  // thing either side ever addresses each other by before a request is
  // actually accepted). No local reset-on-peer-change needed anymore: since
  // this is a plain lookup keyed by the *current* peer's displayId, it
  // naturally reads "none" for a peer nothing's been sent to yet.
  // "failed" (e.g. the match ended before the request landed) reads as
  // "none" here — the FriendButton's own Add action is the retry, there's
  // no separate "try again" affordance on this specific surface the way
  // MyProfileSheet's History list has one.
  const peerFriendAction = peer ? friendActionState.get(peer.displayId) : undefined
  const friendState: FriendState = peerFriendAction === "friends" ? "friends" : peerFriendAction === "requested" ? "requested" : "none"

  function handleAddFriend() {
    if (!peer || friendState !== "none") return
    sendFriendRequestTo(peer.displayId)
  }

  // Blocking from the match screen ends the call (the real block()) —
  // lib/db.ts's addBlock() now also severs any friendship/pending request
  // between the two accounts as part of that same transaction, so there's
  // no separate "also remove them as a friend" step needed here anymore.
  function handleBlockPeer() {
    block()
  }

  const [profileOpen, setProfileOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // Live match chat isn't persisted (see useMatchmaking's `messages`) so
  // there's no server-computed unread count the way friend chat has one —
  // this is purely local bookkeeping over the same `messages` array
  // MatchChatPanel already renders: how many of the peer's messages have
  // arrived since the chat was last actually open, so the chat icon can
  // badge them the same way the Friends icon already badges real unread
  // friend messages.
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const seenChatMessageCountRef = useRef(0)
  useEffect(() => {
    // A fresh room (new match, or the previous one ending) starts with a
    // clean slate regardless of whatever the last conversation left
    // unread — there is nothing left to have missed from a room that's
    // already gone.
    seenChatMessageCountRef.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the room itself changing, not mirroring existing state
    setChatUnreadCount(0)
  }, [roomId])
  useEffect(() => {
    if (chatOpen) {
      // Viewing the chat marks everything currently in it as seen.
      seenChatMessageCountRef.current = messages.length
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the chat being opened, not mirroring existing state
      setChatUnreadCount(0)
      return
    }
    const newlyArrivedFromPeer = messages.slice(seenChatMessageCountRef.current).filter((m) => m.from === "peer").length
    seenChatMessageCountRef.current = messages.length
    if (newlyArrivedFromPeer > 0) setChatUnreadCount((prev) => prev + newlyArrivedFromPeer)
  }, [messages, chatOpen])
  const [myProfileOpen, setMyProfileOpen] = useState(false)
  useEffect(() => {
    const panel = new URLSearchParams(window.location.search).get("panel")
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore homepage overlays from the return route
    if (panel === "profile") setMyProfileOpen(true)
    if (panel === "friends") setFriendsOpen(true)
  }, [])
  const [dismissedMatchInvitations, setDismissedMatchInvitations] = useState<Set<string>>(new Set())
  const incomingMatchInvitation = matchInvitations.find((invite) => invite.direction === "incoming" && !dismissedMatchInvitations.has(invite.id)) ?? null
  const canAcceptMatchInvitation = realtimeReady && !cameraUnavailable && (state === "idle" || state === "paused")

  useEffect(() => {
    if (roomId) {
      // A friend accepted a direct invitation; reveal the existing call UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFriendsOpen(false)
      setMyProfileOpen(false)
      setProfileOpen(false)
    }
  }, [roomId])

  return (
    <div className={`relative flex h-dvh w-dvw flex-col overflow-hidden ${useHomeSplit ? "bg-home-glow" : "bg-background"}`}>
      <main className={`relative z-10 flex min-h-0 flex-1 flex-row ${useHomeSplit ? "gap-0 p-0" : "gap-1 p-0 md:p-2"}`}>
        {/* Below `md`, this is your own small self-view bubble floating over
            the full-screen peer video — the "picture in picture" frame
            Omegle TV and similar mobile-optimized video-chat sites use,
            rather than squeezing two equal-width columns into a phone-width
            screen. `absolute` takes it out of `<main>`'s flex flow entirely
            on mobile, so the peer panel below (still `flex-1`) is free to
            become the only flex item and fill the whole screen on its own —
            no separate "mobile" markup for that side. At `md` and up it
            reverts to exactly the side-by-side desktop layout this always
            was. */}
        <motion.div
          layout
          initial={false}
          layoutDependency={useHomeSplit}
          transition={{
            // The camera should only travel/expand when the guest leaves
            // home to start matching. Entering home (initial hydration,
            // returning from another screen, or pausing) is immediate so the
            // landing composition never replays the transition by itself —
            // and so is anything happening in the brief window right after
            // this tab regains visibility (see suppressHomeLayoutAnimation's
            // own doc comment above), regardless of which way the shell
            // state happens to read at that exact moment.
            layout: reduceMotion || !animateIntoMatching || suppressHomeLayoutAnimation
              ? { duration: 0 }
              : { duration: 0.52, ease: EASE_OUT },
          }}
          className={
            useHomeSplit
              ? "absolute left-4 top-[max(5rem,calc(env(safe-area-inset-top)+4rem))] z-20 aspect-[3/4] w-[62vw] max-w-60 overflow-hidden rounded-2xl border border-white/15 shadow-xl shadow-black/50 sm:left-6 sm:top-24 sm:w-52 sm:max-w-none md:relative md:left-auto md:top-auto md:z-auto md:aspect-auto md:h-full md:w-[42%] md:max-w-none md:flex-none md:rounded-none md:border-0 md:shadow-none"
              : "absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 aspect-[3/4] w-24 overflow-hidden rounded-2xl border-2 border-white/25 shadow-lg shadow-black/40 sm:w-28 md:relative md:right-auto md:top-auto md:z-auto md:aspect-auto md:h-full md:w-auto md:min-h-0 md:min-w-0 md:flex-1 md:overflow-visible md:rounded-2xl md:border md:border-border md:shadow-none"
          }
        >
          <SelfPanel
            localStream={localStream}
            status={status}
            flushDesktop={useHomeSplit}
          />
          {/* Every personal control is anchored to the self-video itself.
              Friends/profile sit at the top and media/chat at the bottom;
              mobile call controls are rendered outside this clipped self-view below. */}
          {signedIn && legalAccepted && onboarded && !restriction && (
            <>
              {/* Deliberately faint until touched — this is your own utility
                  corner, not the point of the screen, so it should recede
                  rather than compete with the person you're talking to. */}
              <div className={`absolute z-30 flex items-center gap-1 rounded-full bg-black/35 p-1 backdrop-blur-sm transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 ${onHomeScreen ? "right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] opacity-75" : "right-[max(0.25rem,env(safe-area-inset-right))] top-[max(0.25rem,env(safe-area-inset-top))] opacity-45 md:right-4 md:top-4 md:z-10 md:opacity-25"}`}>
                {FRIENDS_ENABLED && (
                  <button
                    type="button"
                    onClick={() => setFriendsOpen(true)}
                    aria-label={friendsNotifications > 0 ? `Friends — ${friendsNotifications} new` : "Friends"}
                    className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    <UsersIcon className="h-[18px] w-[18px]" />
                    {friendsNotifications > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-accent-foreground">
                        {friendsNotifications}
                      </span>
                    )}
                  </button>
                )}
                <ProfileMenu
                  handle={myProfile.handle}
                  username={myProfile.username}
                  profilePhoto={myProfile.profilePhoto}
                  onOpenProfile={() => setMyProfileOpen(true)}
                />
              </div>
              <div className={onHomeScreen ? "absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 flex items-center justify-end" : "absolute bottom-4 right-4 z-10 hidden items-center justify-end md:flex"}>
                <div className={`flex items-center gap-1 rounded-full bg-black/35 p-1 backdrop-blur-sm transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 ${onHomeScreen ? "opacity-85" : "opacity-25"}`}>
                  <ControlBar
                    micEnabled={micEnabled}
                    onToggleMic={toggleMic}
                  />
                  <div className="h-5 w-px shrink-0 bg-white/20" />
                  <CompactChat disabled={!canChat} onOpenChat={() => setChatOpen(true)} unreadCount={chatUnreadCount} />
                </div>
              </div>
              <MatchChatPanel
                key={roomId ?? "no-room"}
                open={chatOpen}
                onClose={() => setChatOpen(false)}
                peer={displayedPeer}
                messages={messages}
                disabled={!canChat}
                peerTyping={peerTyping}
                onSend={sendChat}
                onNotifyTyping={notifyTyping}
              />
            </>
          )}
        </motion.div>
        <div className={`relative h-full min-h-0 min-w-0 flex-1 ${useHomeSplit ? "md:rounded-none md:border-0" : "md:rounded-2xl md:border md:border-border"}`}>
          {authLoading ? null : !signedIn ? (
            <SignInLanding onSignIn={handleGoogleSignIn} errorMessage={authError} />
          ) : restriction && restriction.reason !== "acceptance_required" ? (
            // LEGAL FLOW OWNS LEGAL STATE — `acceptance_required` from the
            // realtime ticket endpoint is deliberately excluded here.
            // Realtime doesn't even connect until `legalAccepted` is
            // already true (see `realtimeEnabled` above), so this
            // shouldn't be reachable in the normal flow at all; if it ever
            // is (e.g. legal requirements changed mid-session, server-side,
            // between this render and a ticket request actually reaching
            // it), the correct response is AgeGate below via `legal.status
            // === "required"` re-checking for itself — never
            // AccountRestricted's "sign out and back in" copy, which both
            // mischaracterizes what's actually needed and duplicates a
            // decision the legal-status check already owns.
            <AccountRestricted restriction={restriction} onSignOut={() => signOut({ callbackUrl: "/" })} />
          ) : legal.status === "checking" ? null : legal.status === "error" ? (
            <LegalStatusError errorCode={legal.errorCode} onRetry={legal.retry} />
          ) : legal.status === "required" ? (
            <AgeGate onAccept={legal.accept} />
          ) : !myProfile.profileHydrated ? null : !hasUsername ? (
            <ChooseUsername onChosen={myProfile.setUsername} />
          ) : !hasGender ? (
            <ChooseGender onChosen={myProfile.setGender} />
          ) : activeOnAnotherDevice ? (
            // A genuinely different, still-active device/tab already owns
            // this account's realtime connection right now (see
            // useSignalingSocket.ts's `supersededElsewhere`) — matching
            // never starts here until that changes, same as the other
            // gates above, but this one is informational, not punitive.
            <ActiveOnAnotherDevice onRetry={retryRealtimeConnection} />
          ) : (
            <>
              <SwipeStage
                matchState={swipeMatchState}
                peer={displayedPeer}
                peerMicEnabled={peerMicEnabled}
                friendState={friendState}
                onAddFriend={handleAddFriend}
                onViewProfile={() => setProfileOpen(true)}
                remoteStream={remoteStream}
                roomId={roomId}
                onRemoteVideoPlaying={reportRemoteVideoPlaying}
                onSwipeComplete={handleSwipeComplete}
                onPauseMatching={pauseMatching}
                onResume={cameraUnavailable ? undefined : findMatch}
                cameraUnavailable={cameraUnavailable}
                onlineCount={onlineCount}
              />
              <SafetyMenu
                disabled={!hasMatchedPeer}
                onViewProfile={() => setProfileOpen(true)}
                onReport={report}
                onBlock={handleBlockPeer}
              />
            </>
          )}
        </div>
      </main>
      {signedIn && legalAccepted && onboarded && !restriction && !onHomeScreen && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 flex items-center gap-1 rounded-full bg-black/55 p-1 backdrop-blur-sm md:hidden">
          <ControlBar micEnabled={micEnabled} onToggleMic={toggleMic} />
          <div className="h-5 w-px shrink-0 bg-white/20" />
          <CompactChat disabled={!canChat} onOpenChat={() => setChatOpen(true)} unreadCount={chatUnreadCount} />
        </div>
      )}

      {FRIENDS_ENABLED && (
        <>
          <FriendsPanel
            open={friendsOpen}
            onClose={() => setFriendsOpen(false)}
            friends={friends}
            requests={requests}
            matchInvitations={matchInvitations}
            matchInviteError={matchInviteError}
            canInviteToMatch={canAcceptMatchInvitation}
            onInviteToMatch={inviteFriendToMatch}
            onRespondToMatchInvitation={respondToMatchInvitation}
            onAcceptRequest={(id) => respondToFriendRequest(id, true)}
            onDeclineRequest={(id) => respondToFriendRequest(id, false)}
            onRemoveFriend={unfriend}
            onBlockPerson={(userId) => blockFriendAccount(userId)}
            onReportPerson={(userId, category) => reportUser(userId, category)}
            onUnreadMessagesChange={setUnreadMessages}
            friendMessages={friendMessages}
            onSendFriendMessage={sendFriendChatMessage}
            onMarkFriendChatRead={markFriendChatRead}
            peerFriendTyping={peerFriendTyping}
            onNotifyFriendTyping={notifyFriendTyping}
          />
          <IncomingFriendRequestToast
            request={incomingMatchInvitation ? null : toastRequest}
            onAccept={(id) => respondToFriendRequest(id, true)}
            onDecline={(id) => respondToFriendRequest(id, false)}
            onDismiss={dismissFriendToast}
            onViewProfile={() => setViewingToastRequest(toastRequest)}
          />
          <IncomingMatchInvitationToast
            invitation={incomingMatchInvitation}
            canAccept={canAcceptMatchInvitation}
            error={matchInviteError}
            onRespond={respondToMatchInvitation}
            onDismiss={(id) => setDismissedMatchInvitations((previous) => new Set([...previous, id]))}
          />
          <RequestProfileSheet
            request={viewingToastRequest}
            onAccept={(id) => {
              respondToFriendRequest(id, true)
              setViewingToastRequest(null)
            }}
            onDecline={(id) => {
              respondToFriendRequest(id, false)
              setViewingToastRequest(null)
            }}
            onReport={(userId, category) => reportUser(userId, category)}
            onClose={() => setViewingToastRequest(null)}
          />
        </>
      )}
      <PeerProfileSheet
        peer={displayedPeer}
        open={profileOpen}
        friendState={friendState}
        onAddFriend={handleAddFriend}
        onClose={() => setProfileOpen(false)}
      />
      <MyProfileSheet
        profileReady={myProfile.profileHydrated}
        handle={myProfile.handle}
        history={history}
        blockedUsers={blockedUsers}
        onUnblockUser={unblockUser}
        friendActionState={friendActionState}
        onSendFriendRequest={sendFriendRequestTo}
        onSignOut={() => signOut({ callbackUrl: "/" })}
        open={myProfileOpen}
        onClose={() => setMyProfileOpen(false)}
        profilePhoto={myProfile.profilePhoto}
        onUpdateProfilePhoto={myProfile.updateProfilePhoto}
        username={myProfile.username}
        setUsername={myProfile.setUsername}
        gender={myProfile.gender}
        setGender={myProfile.setGender}
        bio={myProfile.bio}
        setBio={myProfile.setBio}
        posts={myProfile.posts}
        onAddPost={myProfile.addPost}
        onRemovePost={myProfile.removePost}
      />
    </div>
  )
}
