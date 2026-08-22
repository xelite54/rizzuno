"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { getOrCreateHandle } from "@/lib/guest"
import type { Gender } from "@/lib/signaling/protocol"

export type Post = { id: string; dataUrl: string }
export type { Gender }

type StoredProfile = {
  profilePhoto: string | null
  username: string
  gender: Gender | null
  bio: string
  posts: Post[]
}

const STORAGE_PREFIX = "rizzuno:profile:"

/**
 * Profile photo, username, bio, and posts persist in this browser's
 * localStorage, keyed by the *authenticated account's* stable id (Google's
 * `sub`, from the Auth.js session) rather than a random per-tab guest id —
 * so the same profile is there across tabs, reloads, and sign-out/sign-in
 * with the same Google account, not just for the lifetime of one tab.
 *
 * Still entirely client-side: nothing here is ever sent to or stored on
 * Rizzuno's server (see lib/db.ts, which deliberately holds no profile
 * content). That's a real limitation (no cross-device sync) but an honest
 * one — the legal fact sheet should say "client-side only," not "synced,"
 * unless this actually changes.
 */
export function useMyProfile() {
  const { data: session, status: sessionStatus } = useSession()
  const userId = session?.user?.id ?? ""

  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [gender, setGender] = useState<Gender | null>(null)
  const [bio, setBio] = useState("")
  const [posts, setPosts] = useState<Post[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [handle, setHandle] = useState("")

  // Loads whatever was saved for this account, and marks itself hydrated —
  // both together in one pass, using userId directly rather than waiting on
  // a second render, so there's never a moment where `hydrated` is true but
  // the fields loaded under the wrong key. Re-runs if the signed-in account
  // itself changes (e.g. sign out, sign in as someone else in the same tab).
  useEffect(() => {
    if (sessionStatus === "loading") return
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- signed out: nothing to load, reset to blank
      setProfilePhoto(null)
      setUsername("")
      setGender(null)
      setBio("")
      setPosts([])
      setHandle("")
      setHydrated(false)
      return
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + userId)
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredProfile>
        setProfilePhoto(stored.profilePhoto ?? null)
        setUsername(stored.username ?? "")
        setGender(stored.gender ?? null)
        setBio(stored.bio ?? "")
        setPosts(stored.posts ?? [])
      }
    } catch {
      // Corrupt or unavailable storage — start fresh rather than crash.
    }
    setHandle(getOrCreateHandle(userId))
    setHydrated(true)
  }, [userId, sessionStatus])

  // Saves on every change, but only once the load above has actually run —
  // otherwise the very first render (before restoring) would overwrite a
  // real saved profile with blanks.
  useEffect(() => {
    if (!userId || !hydrated) return
    const stored: StoredProfile = { profilePhoto, username, gender, bio, posts }
    try {
      window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(stored))
    } catch {
      // Storage full or unavailable — this save just won't stick.
    }
  }, [userId, hydrated, profilePhoto, username, gender, bio, posts])

  /** Wipes this browser's copy of the profile for the current account — used after a confirmed account deletion (see MyProfileSheet's "Delete account"). */
  function resetLocalProfile() {
    if (userId) {
      try {
        window.localStorage.removeItem(STORAGE_PREFIX + userId)
      } catch {
        // Nothing more to do if storage itself is unavailable.
      }
    }
    setProfilePhoto(null)
    setUsername("")
    setGender(null)
    setBio("")
    setPosts([])
  }

  return {
    handle,
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
    resetLocalProfile,
  }
}
