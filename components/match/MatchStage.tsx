"use client"

import { useEffect, useRef, useState } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { useLocalMedia } from "@/hooks/useLocalMedia"
import { useMatchmaking } from "@/hooks/useMatchmaking"
import { useFriends } from "@/hooks/useFriends"
import { useMyProfile } from "@/hooks/useMyProfile"
import { SwipeStage } from "./SwipeStage"
import { SelfPanel } from "./SelfPanel"
import { CompactChat } from "./CompactChat"
import { SafetyMenu } from "./SafetyMenu"
import { ProfileMenu } from "./ProfileMenu"
import { ControlBar } from "./ControlBar"
import { FriendsPanel } from "./FriendsPanel"
import { IncomingFriendRequestToast } from "./IncomingFriendRequestToast"
import { RequestProfileSheet } from "./RequestProfileSheet"
import { SignInLanding } from "./SignInLanding"
import { AgeGate } from "./AgeGate"
import { AccountRestricted } from "./AccountRestricted"
import { ChooseUsername } from "./ChooseUsername"
import { ChooseGender } from "./ChooseGender"
import { PeerProfileSheet } from "./PeerProfileSheet"
import { MatchChatPanel } from "./MatchChatPanel"
import { MyProfileSheet } from "./MyProfileSheet"
import { UndoSkipToast } from "./UndoSkipToast"
import type { FriendState } from "./FriendButton"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import type { PendingRequest } from "@/hooks/useFriends"
import { useLegalAcceptance } from "@/hooks/useLegalAcceptance"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"
import { UsersIcon } from "@/components/icons"

// How long a completed skip stays undoable before the real teardown/next-
// match search actually commits.
const UNDO_SKIP_WINDOW_MS = 3000

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

export function MatchStage() {
  const { stream, videoTrack, audioTrack, status, micEnabled, cameraEnabled, toggleMic, toggleCamera } =
    useLocalMedia()

  // Lifted up here (not owned by MyProfileSheet) because a real match needs
  // to see this guest's username too — useMatchmaking hands it to the server.
  const myProfile = useMyProfile()

  const {
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
  } = useMatchmaking(
    videoTrack,
    audioTrack,
    micEnabled,
    myProfile.handle,
    myProfile.username,
    myProfile.gender ?? undefined,
    myProfile.profilePhoto
  )

  // Nothing works until the guest signs in with the real Google OAuth
  // session (see auth.ts). "loading" covers the brief moment right after a
  // refresh where Auth.js is still checking for an existing session cookie
  // — treated as neither signed in nor signed out, so the landing screen
  // doesn't flash on and off for people who are actually already signed in.
  const { status: sessionStatus } = useSession()
  const signedIn = sessionStatus === "authenticated"
  const authLoading = sessionStatus === "loading"

  // 18+ affirmation + Terms/Privacy acceptance, recorded server-side against
  // the signed-in account (see hooks/useLegalAcceptance.ts) — required
  // before matchmaking the same way choosing a username/gender is.
  const legal = useLegalAcceptance(signedIn)
  const legalAccepted = legal.status === "accepted"

  // Auth.js lands a failed/cancelled Google sign-in back on this page with
  // `?error=...` — read it once, show it, then scrub it from the URL so a
  // refresh doesn't keep re-showing a stale error.
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

  // Choosing a username, then a gender, is required right after signing in,
  // before matching starts — both are how a real match will actually see you.
  const hasUsername = myProfile.username.trim().length > 0
  const hasGender = myProfile.gender !== null
  const onboarded = hasUsername && hasGender

  // Spec §2: as soon as the guest is online, signed in, and fully onboarded,
  // start looking — no manual "start" step beyond that.
  const requested = useRef(false)
  useEffect(() => {
    if (connected && signedIn && legalAccepted && onboarded && !restriction && !requested.current) {
      requested.current = true
      findMatch()
    }
  }, [connected, signedIn, legalAccepted, onboarded, restriction, findMatch])

  // A completed skip doesn't tear down the connection right away — it waits
  // out a short undo window first. The match stays genuinely live behind the
  // scenes (nothing fake to restore), just visually masked, so Undo really
  // does bring back the same person rather than re-creating them.
  const [pendingSkip, setPendingSkip] = useState<{ peer: PeerProfile; timer: ReturnType<typeof setTimeout> } | null>(
    null
  )

  useEffect(() => {
    if (!pendingSkip) return
    return () => clearTimeout(pendingSkip.timer)
  }, [pendingSkip])

  function handleSwipeComplete() {
    if (!peer) {
      skip()
      return
    }
    const skippedPeer = peer
    const timer = setTimeout(() => {
      setPendingSkip(null)
      skip()
    }, UNDO_SKIP_WINDOW_MS)
    setPendingSkip({ peer: skippedPeer, timer })
  }

  function handleUndoSkip() {
    if (!pendingSkip) return
    clearTimeout(pendingSkip.timer)
    setPendingSkip(null)
  }

  // Pausing while a skip's undo window is still ticking must cancel that
  // timer — otherwise it would fire skip() a few seconds later and quietly
  // put the guest right back into the queue, undoing the pause.
  function handlePauseMatching() {
    if (pendingSkip) {
      clearTimeout(pendingSkip.timer)
      setPendingSkip(null)
    }
    pauseMatching()
  }

  // Their name/profile/chat go away the instant you skip — but the video
  // itself keeps playing (the connection is genuinely still open during the
  // undo window) rather than cutting to a blank tile, and the stage reads as
  // "searching" from the moment you skip, not only once the real skip()
  // fires a few seconds later.
  //
  // When that timer does fire, skip() clears the peer immediately but the
  // underlying WebRTC connection can take a beat longer to actually report
  // itself as disconnected — during that gap `state` still reads "active"
  // with no peer to show, which would otherwise flash an empty stage between
  // the undo window ending and "Finding someone…" reappearing. Treating
  // "active with no peer" as "searching" too closes that gap, so the undo
  // window and the real search join up with nothing blank in between.
  const displayedPeer = pendingSkip ? null : peer
  const swipeMatchState = pendingSkip || (state === "active" && !peer) ? "searching" : state
  const inCall = state === "active" && !pendingSkip && Boolean(peer)

  // Friends + friend requests live here, shared between the Friends panel
  // and the live in-call incoming-request toast, so accepting/declining
  // from either place stays in sync with the other.
  const {
    friends,
    requests,
    blockedIds,
    blockedUsers,
    toastRequestId,
    acceptRequest,
    declineRequest,
    removeFriend,
    blockPerson,
    unblockPerson,
    dismissToast,
  } = useFriends()
  const [unreadMessages, setUnreadMessages] = useState(0)
  const friendsNotifications = requests.length + unreadMessages
  const toastRequest = requests.find((request) => request.id === toastRequestId) ?? null
  // Set when "View profile" is tapped on the live toast — shows the request's
  // full-screen profile (Decline/Accept) directly, separate from opening the
  // whole Friends panel. Captured as its own value (not derived from the
  // toast's own state) so the toast's independent auto-dismiss timer can't
  // yank this away mid-read.
  const [viewingToastRequest, setViewingToastRequest] = useState<PendingRequest | null>(null)

  const [friendsOpen, setFriendsOpen] = useState(false)

  // Friend status for the *current match* (separate from the Friends panel's
  // own demo data) — resets whenever the matched person changes, and is
  // shared between the inline badge and the "View profile" sheet so they
  // never disagree. Reset happens during render (React's documented pattern
  // for "adjust state when a prop changes"), not in an effect, so it can't
  // flash the previous person's state for a frame.
  const [friendState, setFriendState] = useState<FriendState>("none")
  const [friendStatePeerId, setFriendStatePeerId] = useState<string | null>(null)
  if ((peer?.displayId ?? null) !== friendStatePeerId) {
    setFriendStatePeerId(peer?.displayId ?? null)
    setFriendState("none")
  }

  // Sending a request only ever moves this to "requested" — it becomes
  // "friends" solely if the other person actually accepts. There's no real
  // backend for a demo match to do that, so it honestly stays pending rather
  // than faking an instant mutual friendship.
  function handleAddFriend() {
    if (friendState !== "none") return
    setFriendState("requested")
  }

  // Blocking from the match screen ends the call (the real block()) and also
  // remembers them in the shared blocked list, so they're kept out of
  // Friends search and can't send a request later, same as blocking from
  // the Friends panel.
  function handleBlockPeer() {
    if (peer) blockPerson(peer.displayId, peer.username ?? peer.handle)
    block()
  }

  const [profileOpen, setProfileOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [myProfileOpen, setMyProfileOpen] = useState(false)

  return (
    <div className="relative flex h-dvh w-dvw flex-col overflow-hidden bg-background">
      <main className="relative z-10 flex min-h-0 flex-1 flex-row gap-1 p-2">
        <div className="relative h-full min-h-0 min-w-0 flex-1 rounded-2xl border border-border">
          <SelfPanel stream={stream} status={status} cameraEnabled={cameraEnabled} />
          {/* Your own controls — mic, camera, chat, friends, profile — all live
              on your own video, mirroring the ••• utility corner on their side.
              None of it is reachable until signed in and fully onboarded. */}
          {signedIn && legalAccepted && onboarded && !restriction && (
            <>
              {/* Deliberately faint until touched — this is your own utility
                  corner, not the point of the screen, so it should recede
                  rather than compete with the person you're talking to. */}
              <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-black/20 p-1 opacity-25 backdrop-blur-sm transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100">
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
              <div className="absolute bottom-4 right-4 z-10 flex items-center justify-end">
                <div className="flex items-center gap-1 rounded-full bg-black/20 p-1 opacity-25 backdrop-blur-sm transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100">
                  <ControlBar
                    micEnabled={micEnabled}
                    cameraEnabled={cameraEnabled}
                    onToggleMic={toggleMic}
                    onToggleCamera={toggleCamera}
                  />
                  <div className="h-5 w-px shrink-0 bg-white/20" />
                  <CompactChat disabled={!inCall} onOpenChat={() => setChatOpen(true)} />
                </div>
              </div>
              <MatchChatPanel
                open={chatOpen}
                onClose={() => setChatOpen(false)}
                peer={displayedPeer}
                messages={messages}
                disabled={!inCall}
                peerTyping={peerTyping}
                onSend={sendChat}
                onNotifyTyping={notifyTyping}
              />
            </>
          )}
        </div>
        <div className="relative h-full min-h-0 min-w-0 flex-1 rounded-2xl border border-border">
          {authLoading ? null : !signedIn ? (
            <SignInLanding
              onSignIn={() => signIn("google", { callbackUrl: "/" })}
              errorMessage={authError}
            />
          ) : restriction ? (
            <AccountRestricted restriction={restriction} onSignOut={() => signOut({ callbackUrl: "/" })} />
          ) : legal.status === "checking" ? null : legal.status === "required" ? (
            <AgeGate onAccept={legal.accept} />
          ) : !hasUsername ? (
            <ChooseUsername onChosen={myProfile.setUsername} />
          ) : !hasGender ? (
            <ChooseGender onChosen={myProfile.setGender} />
          ) : (
            <>
              <SwipeStage
                matchState={swipeMatchState}
                peer={displayedPeer}
                peerMicEnabled={peerMicEnabled}
                friendState={friendState}
                onAddFriend={handleAddFriend}
                remoteStream={remoteStream}
                onSwipeComplete={handleSwipeComplete}
                locked={pendingSkip !== null}
                onPauseMatching={handlePauseMatching}
                onResume={findMatch}
              />
              <SafetyMenu
                disabled={!inCall}
                onViewProfile={() => setProfileOpen(true)}
                onReport={report}
                onBlock={handleBlockPeer}
              />
              <UndoSkipToast
                name={pendingSkip ? (pendingSkip.peer.username ?? pendingSkip.peer.handle) : null}
                windowMs={UNDO_SKIP_WINDOW_MS}
                onUndo={handleUndoSkip}
              />
            </>
          )}
        </div>
      </main>

      {FRIENDS_ENABLED && (
        <>
          <FriendsPanel
            open={friendsOpen}
            onClose={() => setFriendsOpen(false)}
            friends={friends}
            requests={requests}
            blockedIds={blockedIds}
            onAcceptRequest={acceptRequest}
            onDeclineRequest={declineRequest}
            onRemoveFriend={removeFriend}
            onBlockPerson={blockPerson}
            onUnreadMessagesChange={setUnreadMessages}
          />
          <IncomingFriendRequestToast
            request={toastRequest}
            onAccept={acceptRequest}
            onDecline={declineRequest}
            onDismiss={dismissToast}
            onViewProfile={() => setViewingToastRequest(toastRequest)}
          />
          <RequestProfileSheet
            request={viewingToastRequest}
            onAccept={(id) => {
              acceptRequest(id)
              setViewingToastRequest(null)
            }}
            onDecline={(id) => {
              declineRequest(id)
              setViewingToastRequest(null)
            }}
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
        handle={myProfile.handle}
        history={history}
        blockedUsers={blockedUsers}
        onUnblockPerson={unblockPerson}
        onSignOut={() => signOut({ callbackUrl: "/" })}
        onAccountDeleted={() => {
          myProfile.resetLocalProfile()
          signOut({ callbackUrl: "/" })
        }}
        open={myProfileOpen}
        onClose={() => setMyProfileOpen(false)}
        profilePhoto={myProfile.profilePhoto}
        setProfilePhoto={myProfile.setProfilePhoto}
        username={myProfile.username}
        setUsername={myProfile.setUsername}
        gender={myProfile.gender}
        setGender={myProfile.setGender}
        bio={myProfile.bio}
        setBio={myProfile.setBio}
        posts={myProfile.posts}
        setPosts={myProfile.setPosts}
      />
    </div>
  )
}
