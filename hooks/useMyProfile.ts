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
  //
  // Always resets to blank FIRST, unconditionally, before attempting to
  // load anything for the new `userId` — a real bug this fixes: the
  // previous version only reset on sign-out (`!userId`); switching directly
  // from account A to account B in the same tab, where B has never saved a
  // profile before (`raw` comes back null), left every field exactly as A
  // had left them — B would silently see A's photo/username/gender/bio/
  // posts until they happened to edit one. A blank slate first means an
  // account with nothing saved actually presents as nothing saved.
  useEffect(() => {
    if (sessionStatus === "loading") return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting before loading the new account's own data (or nothing, if signed out) — never carrying over the previous account's fields
    setProfilePhoto(null)
    setUsername("")
    setGender(null)
    setBio("")
    setPosts([])
    setHandle("")
    setHydrated(false)

    if (!userId) return

    let cancelled = false

    async function load() {
      let localUsername = ""
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + userId)
        if (raw) {
          const stored = JSON.parse(raw) as Partial<StoredProfile>
          if (cancelled) return
          setProfilePhoto(stored.profilePhoto ?? null)
          localUsername = stored.username ?? ""
          setUsername(localUsername)
          setGender(stored.gender ?? null)
          setBio(stored.bio ?? "")
          setPosts(stored.posts ?? [])
        }
      } catch {
        // Corrupt or unavailable storage — start fresh rather than crash.
      }

      // The server is the actual source of truth for username uniqueness
      // (see lib/db.ts's claimUsername/app/api/profile/username) — this
      // browser's own localStorage is just a client-side cache of it. If
      // this browser has never saved one locally (a new device, or storage
      // that got cleared) but the account already permanently claimed one
      // server-side, restore that instead of showing ChooseUsername again
      // for an account that isn't actually new. Best-effort: a failed fetch
      // just leaves whatever localStorage already provided (usually
      // nothing, in this branch) — never blocks hydration on it.
      if (!localUsername) {
        try {
          const res = await fetch("/api/profile/username")
          if (!cancelled && res.ok) {
            const data: { username: string | null } = await res.json()
            if (data.username) setUsername(data.username)
          }
        } catch {
          // Network hiccup — ChooseUsername (or a retry) covers this case;
          // not worth blocking the rest of hydration on it.
        }
      }

      if (cancelled) return
      setHandle(getOrCreateHandle(userId))
      setHydrated(true)
    }

    load()
    return () => {
      cancelled = true
    }
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

  return {
    handle,
    /** Whether this account's profile has actually finished loading (from localStorage, plus a best-effort canonical-username restore from the server) — false for the brief gap while `userId` is known but its data hasn't loaded yet, and while nothing is loaded at all (signed out). MatchStage waits for this before treating onboarding/realtime as ready to evaluate, so it never judges "has a username" from fields that are still mid-reset to blank. */
    profileHydrated: hydrated,
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
  }
}
