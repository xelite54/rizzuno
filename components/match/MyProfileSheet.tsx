"use client"

import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, CloseIcon, PlusIcon, MaleIcon, FemaleIcon } from "@/components/icons"
import { resizeImageToDataUrl } from "@/lib/image"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"
import { PeerProfileSheet } from "./PeerProfileSheet"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import type { Post, Gender } from "@/hooks/useMyProfile"
import type { BlockedUser } from "@/hooks/useFriends"

type MyProfileSheetProps = {
  /** Cosmetic fallback display name, shown until a real username is chosen — see lib/guest.ts. */
  handle: string
  history: PeerProfile[]
  blockedUsers: BlockedUser[]
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
  setPosts: (value: Post[] | ((prev: Post[]) => Post[])) => void
}

type View = "profile" | "edit" | "newPost" | "viewPost" | "history" | "blocked"

const MAX_POSTS = 20

// Profile photo, username, bio, and posts persist per guest identity (see
// useMyProfile) — everything else here (which view is open, in-progress
// drafts, confirm states) is genuinely transient UI state and doesn't need to.
export function MyProfileSheet({
  handle,
  history,
  blockedUsers,
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
  setPosts,
}: MyProfileSheetProps) {
  const [view, setView] = useState<View>("profile")
  const [editPhotoDraft, setEditPhotoDraft] = useState<string | null>(null)
  const [editUsernameDraft, setEditUsernameDraft] = useState("")
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editGenderDraft, setEditGenderDraft] = useState<Gender | null>(null)
  const [editBioDraft, setEditBioDraft] = useState("")
  const [pendingPostImage, setPendingPostImage] = useState<string | null>(null)
  const [viewingPost, setViewingPost] = useState<Post | null>(null)
  // Deleting a post needs a second tap to confirm before it actually happens.
  const [confirmingDeletePost, setConfirmingDeletePost] = useState(false)
  // Same for signing out — needs a second tap too.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  // Outgoing friend requests sent from History — local-only, like everything
  // else here, and separate from the incoming requests the Friends panel
  // manages.
  const [sentRequestIds, setSentRequestIds] = useState<string[]>([])

  const editPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const postInputRef = useRef<HTMLInputElement | null>(null)

  const initial = username ? username.charAt(0).toUpperCase() : handle ? handle.charAt(0) : "?"

  function resetToProfile() {
    setView("profile")
    setPendingPostImage(null)
    setViewingPost(null)
    setConfirmingDeletePost(false)
    setConfirmingSignOut(false)
  }

  function handleClose() {
    resetToProfile()
    onClose()
  }

  function startEditing() {
    setEditPhotoDraft(profilePhoto)
    setEditUsernameDraft(username)
    setEditGenderDraft(gender)
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
    if (editGenderDraft) setGender(editGenderDraft)
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

  function sharePost() {
    if (!pendingPostImage) return
    setPosts((prev) => [{ id: crypto.randomUUID(), dataUrl: pendingPostImage }, ...prev].slice(0, MAX_POSTS))
    resetToProfile()
  }

  function deleteViewingPost() {
    if (!viewingPost) return
    setPosts((prev) => prev.filter((post) => post.id !== viewingPost.id))
    resetToProfile()
  }

  function handleSignOut() {
    // Destroys the real Auth.js session and navigates away. Profile data is
    // untouched — it's keyed by the account's own stable id (see
    // useMyProfile.ts), so it's still there next time this same Google
    // account signs back in.
    onSignOut()
  }

  function sendFriendRequest(displayId: string) {
    setSentRequestIds((prev) => (prev.includes(displayId) ? prev : [...prev, displayId]))
  }

  // Basic data-export: whatever Rizzuno's server actually holds about this
  // account (see app/api/account/data). Profile content itself isn't in
  // that response because it isn't stored server-side at all — it's
  // already visible right here, in the browser that holds it.
  async function handleExportData() {
    setExportBusy(true)
    try {
      const res = await fetch("/api/account/data")
      if (!res.ok) return
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "rizzuno-account-data.json"
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // Export failed — nothing destructive happened, just try again later.
    } finally {
      setExportBusy(false)
    }
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
                onClick={resetToProfile}
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
                        : "My profile"}
            </span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
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

                  <button
                    type="button"
                    onClick={startEditing}
                    className="mt-4 rounded-lg border border-border px-4 py-1.5 text-[13px] font-medium text-foreground transition hover:bg-surface-2"
                  >
                    Edit profile
                  </button>
                </div>

                <div className="mt-8 border-t border-border pt-4">
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
                  {confirmingSignOut ? (
                    <div className="mt-1 rounded-xl bg-surface-2 p-3">
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
                      className="mt-1 w-full rounded-xl px-1 py-2.5 text-left text-[13px] font-medium text-danger transition hover:bg-surface-2"
                    >
                      Sign out
                    </button>
                  )}
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Privacy &amp; data
                  </p>
                  <button
                    type="button"
                    onClick={handleExportData}
                    disabled={exportBusy}
                    className="flex w-full items-center justify-between rounded-xl px-1 py-2.5 text-left text-[13px] text-foreground transition hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span>Download my data</span>
                    <span className="text-[12px] text-muted">{exportBusy ? "Preparing…" : "Export"}</span>
                  </button>
                </div>

                <div className="mt-8">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Posts {posts.length > 0 && <span className="normal-case">· {posts.length}/{MAX_POSTS}</span>}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {/* The add tile always leads, with your most recent post right after it — three
                        across means that post lands in the middle of the row, not off to a side. */}
                    <button
                      type="button"
                      onClick={() => postInputRef.current?.click()}
                      disabled={posts.length >= MAX_POSTS}
                      aria-label={posts.length >= MAX_POSTS ? `Limit of ${MAX_POSTS} posts reached` : "Add a post"}
                      className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
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
                        className="relative aspect-square overflow-hidden rounded-xl bg-surface-2"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local/data-URL post image, not a static asset */}
                        <img src={post.dataUrl} alt="Post" className="h-full w-full object-cover" />
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
                  <label className="mb-1.5 block text-[12px] font-medium text-muted">Gender</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditGenderDraft("male")}
                      aria-pressed={editGenderDraft === "male"}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                        editGenderDraft === "male"
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <MaleIcon className="h-4 w-4" />
                      Male
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditGenderDraft("female")}
                      aria-pressed={editGenderDraft === "female"}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                        editGenderDraft === "female"
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <FemaleIcon className="h-4 w-4" />
                      Female
                    </button>
                  </div>
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

            {view === "newPost" && pendingPostImage && (
              <div className="mx-auto w-full max-w-lg px-6 py-6">
                {/* eslint-disable-next-line @next/next/no-img-element -- local/data-URL post preview, not a static asset */}
                <img src={pendingPostImage} alt="New post preview" className="w-full rounded-2xl border border-border object-cover" />
                <button
                  type="button"
                  onClick={sharePost}
                  className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110"
                >
                  Share
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
                          className="flex-1 rounded-xl border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={deleteViewingPost}
                          className="flex-1 rounded-xl bg-danger px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110"
                        >
                          Delete
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
                      const requested = sentRequestIds.includes(person.displayId)
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
                                sendFriendRequest(person.displayId)
                              }}
                              disabled={requested}
                              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
                            >
                              {requested ? "Requested" : "Add"}
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
                    {/* Blocking is enforced server-side and, as currently built, can't be
                        reversed from here (or anywhere) — no "Unblock" control is shown,
                        since one that didn't actually remove the server-side block would
                        be misleading. See the Community Guidelines for the accurate,
                        current behavior. */}
                    <p className="mb-3 px-1 text-[12px] leading-relaxed text-muted">
                      Blocking is permanent for now — there&apos;s no way to undo it yet.
                    </p>
                    <div className="space-y-1">
                      {blockedUsers.map((person) => (
                        <div key={person.id} className="flex items-center gap-3 rounded-xl px-1 py-2.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground">
                            {person.displayName.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                            {person.displayName}
                          </span>
                        </div>
                      ))}
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
      friendState={viewingHistoryPerson && sentRequestIds.includes(viewingHistoryPerson.displayId) ? "requested" : "none"}
      onAddFriend={() => viewingHistoryPerson && sendFriendRequest(viewingHistoryPerson.displayId)}
      onClose={() => setViewingHistoryPerson(null)}
    />
    </>
  )
}
