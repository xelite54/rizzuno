"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, CloseIcon, PlusIcon, MaleIcon, FemaleIcon, SettingsIcon } from "@/components/icons"
import { resizeImageToDataUrl } from "@/lib/image"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"
import { PeerProfileSheet } from "./PeerProfileSheet"
import type { FriendState } from "./FriendButton"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import type { Post, Gender } from "@/hooks/useMyProfile"
import type { BlockedUser } from "@/hooks/useFriends"

type MyProfileSheetProps = {
  /** Cosmetic fallback display name, shown until a real username is chosen — see lib/guest.ts. */
  handle: string
  history: PeerProfile[]
  blockedUsers: BlockedUser[]
  /** Reverses a block this account previously placed — see server/ws-server.ts's "unblock" handler and lib/db.ts's removeBlock(). `BlockedUser.id` is the real account id (see MatchStage.tsx's mapping from the server's blocked-users snapshot). */
  onUnblockUser: (userId: string) => void
  /** Per-displayId outcome of a friend request sent this session — same map useMatchmaking.ts drives the in-call FriendButton from, reused here so History's "Add"/"Requested" state is the same real thing, not a separate local list. */
  friendActionState: Map<string, "requested" | "friends" | "failed">
  /** Sends a friend request to whoever currently holds this displayId — see lib/signaling/protocol.ts's "friend-request" for how the server resolves it. */
  onSendFriendRequest: (displayId: string) => void
  /** Destroys the real Auth.js session. Profile data itself is untouched — it's keyed by the account's stable id (see useMyProfile.ts), so signing back in with the same Google account restores it. */
  onSignOut: () => void
  open: boolean
  onClose: () => void
  // Profile photo, username, bio, and posts are owned by MatchStage (via
  // useMyProfile) — lifted up there because a real match's peer needs to
  // see this guest's username too, not just this sheet.
  profilePhoto: string | null
  setProfilePhoto: (value: string | null) => void
  username: string
  setUsername: (value: string) => void
  gender: Gender | null
  setGender: (value: Gender) => void
  bio: string
  setBio: (value: string) => void
  posts: Post[]
  /** Server-persisted now (see hooks/useMyProfile.ts) — throws on failure so the caller here can leave the UI in a recoverable state instead of pretending a failed save succeeded. */
  onAddPost: (dataUrl: string) => Promise<void>
  onRemovePost: (postId: string) => Promise<void>
}

type View = "profile" | "edit" | "newPost" | "viewPost" | "history" | "blocked" | "settings"

const MAX_POSTS = 20

// Profile photo, username, bio, and posts persist per guest identity (see
// useMyProfile) — everything else here (which view is open, in-progress
// drafts, confirm states) is genuinely transient UI state and doesn't need to.
export function MyProfileSheet({
  handle,
  history,
  blockedUsers,
  onUnblockUser,
  friendActionState,
  onSendFriendRequest,
  onSignOut,
  open,
  onClose,
  profilePhoto,
  setProfilePhoto,
  username,
  setUsername,
  gender,
  setGender,
  bio,
  setBio,
  posts,
  onAddPost,
  onRemovePost,
}: MyProfileSheetProps) {
  const [view, setView] = useState<View>("profile")
  const [editPhotoDraft, setEditPhotoDraft] = useState<string | null>(null)
  const [editUsernameDraft, setEditUsernameDraft] = useState("")
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editBioDraft, setEditBioDraft] = useState("")
  const [pendingPostImage, setPendingPostImage] = useState<string | null>(null)
  const [sharingPost, setSharingPost] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [viewingPost, setViewingPost] = useState<Post | null>(null)
  // Deleting a post needs a second tap to confirm before it actually happens.
  const [confirmingDeletePost, setConfirmingDeletePost] = useState(false)
  const [deletingPost, setDeletingPost] = useState(false)
  // Same for signing out — needs a second tap too.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  // Gender applies right away (see the Settings toggle below), which is
  // exactly why it needs its own second-tap confirmation — it's a real,
  // immediate change to who this account gets matched with, not a draft
  // sitting behind a separate Save step the way Edit profile's other
  // fields are. Holds whichever gender was just tapped but not yet
  // confirmed; null means no pending change.
  const [pendingGender, setPendingGender] = useState<Gender | null>(null)
  // Which blocked-user ids currently have an in-flight unblock request —
  // per-row, so tapping one doesn't disable the whole list, and disabled
  // long enough to prevent a double-tap sending two "unblock"s for the same
  // person. Cleared reactively once that id actually leaves `blockedUsers`
  // (the server re-sends a fresh snapshot on success — see
  // hooks/useMatchmaking.ts), with a timeout backstop in case it never
  // does (e.g. the request failed silently) so the button doesn't stay
  // stuck on "Unblocking…" forever.
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set())

  const editPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const postInputRef = useRef<HTMLInputElement | null>(null)

  const initial = username ? username.charAt(0).toUpperCase() : handle ? handle.charAt(0) : "?"

  function resetToProfile() {
    setView("profile")
    setPendingPostImage(null)
    setShareError(null)
    setViewingPost(null)
    setConfirmingDeletePost(false)
    setDeletingPost(false)
    setConfirmingSignOut(false)
    setPendingGender(null)
  }

  function handleClose() {
    resetToProfile()
    onClose()
  }

  // History and Blocked users are now reached through Settings, not
  // directly from the main profile view — back from either of those should
  // return to Settings, not skip past it straight to the profile.
  // Everywhere else, one tap back is always straight to the profile.
  function goBack() {
    if (view === "history" || view === "blocked") {
      setView("settings")
      return
    }
    resetToProfile()
  }

  // The header's X only actually closes the whole sheet (and drops you back
  // out to the match screen) from the main profile view. From anywhere
  // else — Settings included — it's "done with this", not "cancel the
  // profile too": it returns to the profile view but leaves the sheet
  // itself open, same as tapping Back until you're home again.
  function handleXClick() {
    if (view === "profile") {
      handleClose()
    } else {
      resetToProfile()
    }
  }

  /** Maps a displayId's raw session outcome ("failed" included) down to the three states PeerProfileSheet's FriendButton actually understands — a failed attempt should just look like "none" there (retryable via the same Add button), whereas the History row list below shows "Try again" explicitly instead of collapsing it. */
  function friendStateFor(displayId: string): FriendState {
    const action = friendActionState.get(displayId)
    return action === "friends" ? "friends" : action === "requested" ? "requested" : "none"
  }

  function startEditing() {
    setEditPhotoDraft(profilePhoto)
    setEditUsernameDraft(username)
    setEditBioDraft(bio)
    setUsernameError(null)
    setView("edit")
  }

  async function handleEditPhotoPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !file.type.startsWith("image/")) return
    try {
      setEditPhotoDraft(await resizeImageToDataUrl(file, 480, 0.8))
    } catch {
      // Unsupported image — skip silently.
    }
  }

  // A username claim is permanent and server-enforced the same way the
  // first pick in ChooseUsername is (see app/api/profile/username) — a
  // rename here goes through the same endpoint, only when the trimmed
  // value actually differs from the account's current username, so editing
  // your photo or bio alone never re-triggers a claim of the name you
  // already own.
  async function saveEdit() {
    if (savingEdit) return
    const trimmed = editUsernameDraft.trim().toLowerCase()
    setUsernameError(null)

    if (trimmed && trimmed !== username) {
      setSavingEdit(true)
      try {
        const res = await fetch("/api/profile/username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmed }),
        })
        if (!res.ok) {
          setUsernameError(
            res.status === 409 ? "That username is already taken — try another." : "Couldn't save username — try again."
          )
          setSavingEdit(false)
          return
        }
      } catch {
        setUsernameError("Couldn't save username — try again.")
        setSavingEdit(false)
        return
      }
      setSavingEdit(false)
    }

    setProfilePhoto(editPhotoDraft)
    setUsername(trimmed || username)
    setBio(editBioDraft.trim())
    setView("profile")
  }

  async function handleNewPostPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !file.type.startsWith("image/") || posts.length >= MAX_POSTS) return
    try {
      setPendingPostImage(await resizeImageToDataUrl(file, 640, 0.78))
      setView("newPost")
    } catch {
      // Unsupported image — skip silently.
    }
  }

  async function sharePost() {
    if (!pendingPostImage || sharingPost) return
    setSharingPost(true)
    setShareError(null)
    try {
      await onAddPost(pendingPostImage)
      resetToProfile()
    } catch {
      setShareError("Couldn't save that post — try again.")
    } finally {
      setSharingPost(false)
    }
  }

  async function deleteViewingPost() {
    if (!viewingPost || deletingPost) return
    setDeletingPost(true)
    try {
      await onRemovePost(viewingPost.id)
      resetToProfile()
    } catch {
      // The post is still there server-side — leave the confirm screen up
      // (not resetToProfile()) so a retry is one tap away instead of
      // silently pretending the delete went through.
      setDeletingPost(false)
    }
  }

  function handleSignOut() {
    // Destroys the real Auth.js session and navigates away. Profile data is
    // untouched — it's keyed by the account's own stable id (see
    // useMyProfile.ts), so it's still there next time this same Google
    // account signs back in.
    onSignOut()
  }

  // The real, reactive clear: once a previously-blocked id is no longer in
  // `blockedUsers` (the server re-sent a fresh snapshot after a successful
  // unblock), its "Unblocking…" busy state is done, whether or not the
  // 5-second backstop in handleUnblock has fired yet.
  useEffect(() => {
    if (unblockingIds.size === 0) return
    const stillBlocked = new Set(blockedUsers.map((b) => b.id))
    // Reacting to an external system (the server's own snapshot changing)
    // — not mirroring existing React state; bails out via the same-
    // reference `prev` return below when nothing actually changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnblockingIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of prev) {
        if (!stillBlocked.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [blockedUsers, unblockingIds])

  function handleUnblock(userId: string) {
    setUnblockingIds((prev) => new Set(prev).add(userId))
    onUnblockUser(userId)
    // Backstop only — the normal path clears this reactively (see the
    // effect below) the moment `blockedUsers` no longer includes this id.
    setTimeout(() => {
      setUnblockingIds((prev) => {
        if (!prev.has(userId)) return prev
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }, 5000)
  }



  // Tapping a history row's background opens that person's full profile —
  // separate from the row's own "Add" button, which still sends a request
  // right from the list without opening anything.
  const [viewingHistoryPerson, setViewingHistoryPerson] = useState<PeerProfile | null>(null)

  return (
    <>
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: "-100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "-100%" }}
          transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
          className="fixed inset-0 z-50 flex flex-col bg-surface"
        >
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
            {view !== "profile" ? (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            ) : null}
            <span className="flex-1 text-[15px] font-semibold text-foreground">
              {view === "edit"
                ? "Edit profile"
                : view === "newPost"
                  ? "New post"
                  : view === "viewPost"
                    ? "Post"
                    : view === "history"
                      ? "History"
                      : view === "blocked"
                        ? "Blocked users"
                        : view === "settings"
                          ? "Settings"
                          : "My profile"}
            </span>
            <button
              type="button"
              onClick={handleXClick}
              aria-label={view === "profile" ? "Close" : "Done"}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {view === "profile" && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                <div className="flex flex-col items-center text-center">
                  <span className="flex h-24 w-24 items-center justify-center rounded-full">
                    {profilePhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                      <img src={profilePhoto} alt="Your profile" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-accent-2 text-[30px] font-semibold text-accent-foreground">
                        {initial}
                      </span>
                    )}
                  </span>

                  <p className="mt-3 text-[17px] font-semibold text-foreground">
                    {username ? `@${username}` : handle}
                  </p>
                  <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-muted">
                    {bio || "No bio yet"}
                  </p>

                  {/* Edit profile still sits exactly on the row's true
                      center — the outer row centers this inner wrapper, and
                      since Settings is positioned off *that* wrapper (not
                      the row), it doesn't add to the wrapper's own width and
                      pull the center off. Settings then lands immediately
                      next to Edit profile, not out at the row's edge. */}
                  <div className="mt-4 flex w-full items-center justify-center">
                    <div className="relative inline-flex">
                      <button
                        type="button"
                        onClick={startEditing}
                        className="rounded-lg border border-border px-4 py-1.5 text-[13px] font-medium text-foreground transition hover:bg-surface-2"
                      >
                        Edit profile
                      </button>
                      {/* Icon only, no background/border of its own —
                          History, Blocked users, changing gender, and Sign
                          out all live behind it now. */}
                      <button
                        type="button"
                        onClick={() => setView("settings")}
                        aria-label="Settings"
                        className="absolute left-full ml-2 flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                      >
                        <SettingsIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-8 border-t border-border pt-5">
                  <p className="mb-3 text-[13px] font-semibold text-foreground">
                    Posts{" "}
                    {posts.length > 0 && (
                      <span className="font-normal text-muted">· {posts.length}/{MAX_POSTS}</span>
                    )}
                  </p>
                  {/* Three across — the add tile always leads, with your
                      most recent post right after it, so that post lands in
                      the middle of the row rather than off to a side. */}
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => postInputRef.current?.click()}
                      disabled={posts.length >= MAX_POSTS}
                      aria-label={posts.length >= MAX_POSTS ? `Limit of ${MAX_POSTS} posts reached` : "Add a post"}
                      className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border text-muted transition hover:border-foreground/25 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted"
                    >
                      <PlusIcon className="h-7 w-7" />
                    </button>
                    {posts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => {
                          setViewingPost(post)
                          setConfirmingDeletePost(false)
                          setView("viewPost")
                        }}
                        aria-label="View post"
                        className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2 shadow-sm transition hover:border-foreground/20"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local/data-URL post image, not a static asset */}
                        <img
                          src={post.dataUrl}
                          alt="Post"
                          className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        />
                      </button>
                    ))}
                  </div>
                  <input ref={postInputRef} type="file" accept="image/*" onChange={handleNewPostPicked} className="hidden" />
                </div>
              </div>
            )}

            {view === "edit" && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => editPhotoInputRef.current?.click()}
                    aria-label="Change profile photo"
                    className="group relative flex h-24 w-24 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  >
                    {editPhotoDraft ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                      <img src={editPhotoDraft} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-accent-2 text-[30px] font-semibold text-accent-foreground">
                        {initial}
                      </span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[11px] font-medium text-foreground transition group-hover:bg-black/60">
                      Change
                    </span>
                  </button>
                  <input
                    ref={editPhotoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditPhotoPicked}
                    className="hidden"
                  />
                </div>

                <div className="mt-6">
                  <label className="mb-1.5 block text-[12px] font-medium text-muted">Username</label>
                  <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-accent-2">
                    <span className="text-[13px] text-muted">@</span>
                    <input
                      value={editUsernameDraft}
                      onChange={(event) => {
                        setEditUsernameDraft(event.target.value.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24))
                        setUsernameError(null)
                      }}
                      placeholder="username"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted focus:outline-none"
                    />
                  </div>
                  {usernameError && <p className="mt-1.5 text-[12px] text-danger">{usernameError}</p>}
                </div>

                <div className="mt-6">
                  <label className="mb-1.5 block text-[12px] font-medium text-muted">Bio</label>
                  <textarea
                    value={editBioDraft}
                    onChange={(event) => setEditBioDraft(event.target.value.slice(0, 200))}
                    placeholder="Tell people a little about yourself"
                    rows={4}
                    className="w-full resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                  />
                  <p className="mt-1 text-right text-[11px] text-muted">{editBioDraft.length}/200</p>
                </div>

                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110 disabled:opacity-50"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {view === "settings" && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                <div>
                  <button
                    type="button"
                    onClick={() => setView("history")}
                    className="flex w-full items-center justify-between rounded-xl px-1 py-2.5 text-left text-[13px] text-foreground transition hover:bg-surface-2"
                  >
                    <span>History</span>
                    <span className="text-[12px] text-muted">
                      {history.length > 0 ? `Last ${history.length}` : "Nobody yet"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("blocked")}
                    className="flex w-full items-center justify-between rounded-xl px-1 py-2.5 text-left text-[13px] text-foreground transition hover:bg-surface-2"
                  >
                    <span>Blocked users</span>
                    <span className="text-[12px] text-muted">
                      {blockedUsers.length > 0 ? blockedUsers.length : "None"}
                    </span>
                  </button>
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">Gender</p>
                  {pendingGender ? (
                    <div className="rounded-xl bg-surface-2 p-3">
                      <p className="text-[12px] leading-relaxed text-muted">
                        Change gender to {pendingGender === "male" ? "Male" : "Female"}? This changes who
                        you&apos;re matched with.
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingGender(null)}
                          className="flex-1 rounded-lg border border-border py-2 text-[13px] font-medium text-muted transition hover:bg-surface hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGender(pendingGender)
                            setPendingGender(null)
                          }}
                          className="flex-1 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Applies right away once confirmed below — unlike the
                          picker that used to live inside Edit profile, there's
                          no separate draft/Save step; tapping one of these is
                          itself the first of the two taps this now needs. */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => gender !== "male" && setPendingGender("male")}
                          aria-pressed={gender === "male"}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                            gender === "male"
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                          }`}
                        >
                          <MaleIcon className="h-4 w-4" />
                          Male
                        </button>
                        <button
                          type="button"
                          onClick={() => gender !== "female" && setPendingGender("female")}
                          aria-pressed={gender === "female"}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                            gender === "female"
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                          }`}
                        >
                          <FemaleIcon className="h-4 w-4" />
                          Female
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Sign out is deliberately last — everything else on this
                    screen is a setting or a lookup; this is the one action
                    that ends the session. */}
                <div className="mt-6 border-t border-border pt-4">
                  {confirmingSignOut ? (
                    <div className="rounded-xl bg-surface-2 p-3">
                      <p className="text-[12px] leading-relaxed text-muted">
                        Sign out? Your profile stays saved for next time you sign back in.
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmingSignOut(false)}
                          className="flex-1 rounded-lg border border-border py-2 text-[13px] font-medium text-muted transition hover:bg-surface hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="flex-1 rounded-lg bg-danger py-2 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(true)}
                      className="w-full rounded-xl px-1 py-2.5 text-left text-[13px] font-medium text-danger transition hover:bg-surface-2"
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </div>
            )}

            {view === "newPost" && pendingPostImage && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                {/* eslint-disable-next-line @next/next/no-img-element -- local/data-URL post preview, not a static asset */}
                <img src={pendingPostImage} alt="New post preview" className="w-full rounded-2xl border border-border object-cover" />
                {shareError && <p className="mt-2 text-[12px] text-danger">{shareError}</p>}
                <button
                  type="button"
                  onClick={sharePost}
                  disabled={sharingPost}
                  className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110 disabled:opacity-50"
                >
                  {sharingPost ? "Sharing…" : "Share"}
                </button>
              </div>
            )}

            {view === "viewPost" && viewingPost && (
              <div className="flex min-h-full flex-col">
                {/* Much bigger than the grid thumbnail — an immersive view, not another small tile. */}
                <div className="flex flex-1 items-center justify-center bg-black px-2 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local/data-URL post image, not a static asset */}
                  <img
                    src={viewingPost.dataUrl}
                    alt="Post"
                    className="max-h-[70vh] w-full max-w-2xl rounded-xl object-contain"
                  />
                </div>
                <div className="mx-auto w-full max-w-lg px-6 py-4">
                  {confirmingDeletePost ? (
                    <div>
                      <p className="mb-2 text-[13px] text-muted">Delete this post? This can&apos;t be undone.</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmingDeletePost(false)}
                          disabled={deletingPost}
                          className="flex-1 rounded-xl border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={deleteViewingPost}
                          disabled={deletingPost}
                          className="flex-1 rounded-xl bg-danger px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110 disabled:opacity-50"
                        >
                          {deletingPost ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeletePost(true)}
                      className="w-full rounded-xl border border-border px-4 py-2.5 text-[13px] font-semibold text-danger transition hover:bg-surface-2"
                    >
                      Delete post
                    </button>
                  )}
                </div>
              </div>
            )}

            {view === "history" && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                {history.length === 0 ? (
                  <p className="mt-8 text-center text-[13px] text-muted">
                    Nobody yet — the last 30 people you match with will show up here.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {history.map((person, index) => {
                      const identity = person.username ? `@${person.username}` : person.handle
                      const friendAction = friendActionState.get(person.displayId) ?? "none"
                      return (
                        <div
                          key={`${person.displayId}-${index}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setViewingHistoryPerson(person)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              setViewingHistoryPerson(person)
                            }
                          }}
                          aria-label={`View ${identity}'s profile`}
                          className="flex cursor-pointer items-center gap-3 rounded-xl px-1 py-2.5 transition hover:bg-surface-2"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground">
                            {person.profilePhoto ? (
                              // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                              <img src={person.profilePhoto} alt="" className="h-full w-full object-cover" />
                            ) : (
                              identity.replace("@", "").charAt(0).toUpperCase()
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="truncate text-[14px] font-medium text-foreground">{identity}</span>
                          </span>
                          {FRIENDS_ENABLED && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onSendFriendRequest(person.displayId)
                              }}
                              disabled={friendAction === "requested" || friendAction === "friends"}
                              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
                            >
                              {friendAction === "friends"
                                ? "Friend"
                                : friendAction === "requested"
                                  ? "Requested"
                                  : friendAction === "failed"
                                    ? "Try again"
                                    : "Add"}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {view === "blocked" && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                {blockedUsers.length === 0 ? (
                  <p className="mt-8 text-center text-[13px] text-muted">Nobody blocked.</p>
                ) : (
                  <>
                    <p className="mb-3 px-1 text-[12px] leading-relaxed text-muted">
                      Unblocking makes it possible to match with this person again — it doesn&apos;t notify them either
                      way.
                    </p>
                    <div className="space-y-1">
                      {blockedUsers.map((person) => {
                        const busy = unblockingIds.has(person.id)
                        return (
                          <div key={person.id} className="flex items-center gap-3 rounded-xl px-1 py-2.5">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground">
                              {person.displayName.charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                              {person.displayName}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUnblock(person.id)}
                              disabled={busy}
                              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
                            >
                              {busy ? "Unblocking…" : "Unblock"}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    <PeerProfileSheet
      peer={viewingHistoryPerson}
      open={viewingHistoryPerson !== null}
      friendState={viewingHistoryPerson ? friendStateFor(viewingHistoryPerson.displayId) : "none"}
      onAddFriend={() => viewingHistoryPerson && onSendFriendRequest(viewingHistoryPerson.displayId)}
      onClose={() => setViewingHistoryPerson(null)}
    />
    </>
  )
}
