"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

type ServerProfile = { username: string | null; profilePhoto: string | null; bio: string; posts: Post[] }

const STORAGE_PREFIX = "rizzuno:profile:"

/**
 * Username, profile photo, bio, and posts are all server-authoritative now
 * (migration 0005_profile_fields; see app/api/profile/me, app/api/profile/
 * posts) — this used to be entirely client-side localStorage, which meant
 * another account could never see a friend's actual photo/bio/posts on
 * their profile (only whatever happened to be sitting in the VIEWING
 * account's own browser). `gender` is deliberately NOT part of this move —
 * it stays exactly what it always was: client state, sent live over the
 * realtime connection for matching (see hooks/useMatchmaking.ts's "hello"/
 * "profile-update"), never persisted to Postgres.
 *
 * localStorage is still used, but only as a same-browser CACHE now, for an
 * instant paint before the server round trip resolves — never the
 * authoritative copy. Every load re-fetches the server and lets it win,
 * except for a one-time backfill: if the server comes back with a
 * completely empty profile (photo/bio/posts) but this browser's cache
 * already had real content — the account existed before this migration —
 * that cached content is pushed to the server once so it becomes durable
 * and visible to other accounts going forward, instead of silently
 * vanishing the next time this hook loads.
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
      // 1) Instant paint from this browser's own cache — best-effort, may
      // be stale or simply absent (a new device, or storage that got
      // cleared). Server data (below) supersedes this the moment it
      // arrives; this is purely to avoid a blank flash until then.
      let cachedGender: Gender | null = null
      let cachedHadContent = false
      let cachedPhoto: string | null = null
      let cachedBio = ""
      let cachedPosts: Post[] = []
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + userId)
        if (raw) {
          const stored = JSON.parse(raw) as Partial<StoredProfile>
          if (cancelled) return
          cachedPhoto = stored.profilePhoto ?? null
          cachedBio = stored.bio ?? ""
          cachedPosts = stored.posts ?? []
          cachedGender = stored.gender ?? null
          cachedHadContent = Boolean(cachedPhoto) || cachedBio.length > 0 || cachedPosts.length > 0
          setProfilePhoto(cachedPhoto)
          if (stored.username) setUsername(stored.username)
          setGender(cachedGender)
          setBio(cachedBio)
          setPosts(cachedPosts)
        }
      } catch {
        // Corrupt or unavailable storage — start fresh rather than crash.
      }

      // 2) The server is now the actual source of truth for username/
      // profilePhoto/bio/posts (see this hook's own doc comment) — always
      // fetch and let it win, not just when the cache was empty, so a
      // change made from another device is picked up here too.
      try {
        const res = await fetch("/api/profile/me")
        if (!cancelled && res.ok) {
          const data: ServerProfile = await res.json()
          if (data.username) setUsername(data.username)
          setProfilePhoto(data.profilePhoto)
          setBio(data.bio)
          setPosts(data.posts)

          // One-time backfill: the server has nothing, but this browser's
          // cache did — a pre-migration account. Push the cached content
          // up so it's durable and actually visible to other accounts
          // (e.g. on a friend's profile) from now on, instead of quietly
          // disappearing the next time this loads.
          const serverEmpty = !data.profilePhoto && !data.bio && data.posts.length === 0
          if (serverEmpty && cachedHadContent) {
            console.log("profile: backfilling pre-migration local profile content to the server")
            if (cachedPhoto || cachedBio) {
              fetch("/api/profile/me", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profilePhoto: cachedPhoto, bio: cachedBio }),
              }).catch(() => {
                // Best-effort — the next save from the editor will retry
                // implicitly by persisting whatever's currently in state.
              })
            }
            // Oldest first, so the final server-side order (each insert is
            // newest-first) ends up matching what was already cached.
            for (const post of [...cachedPosts].reverse()) {
              fetch("/api/profile/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl: post.dataUrl }),
              }).catch(() => {})
            }
          }
        }
      } catch {
        // Network hiccup — keep whatever the cache provided; the save
        // effects below will retry persisting on the next real edit.
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

  // Caches locally on every change, but only once the load above has
  // actually run — otherwise the very first render (before restoring)
  // would overwrite a real saved profile with blanks. Purely a same-
  // browser instant-paint cache now (see this hook's own doc comment) —
  // the effect below is what actually persists photo/bio server-side.
  useEffect(() => {
    if (!userId || !hydrated) return
    const stored: StoredProfile = { profilePhoto, username, gender, bio, posts }
    try {
      window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(stored))
    } catch {
      // Storage full or unavailable — this save just won't stick.
    }
  }, [userId, hydrated, profilePhoto, username, gender, bio, posts])

  // Persists profilePhoto/bio to the server whenever either actually
  // changes post-hydration — this is what makes MyProfileSheet.tsx's
  // existing `setProfilePhoto(editPhotoDraft)` / `setBio(editBioDraft)`
  // calls (unchanged call sites) actually reach Postgres instead of only
  // ever writing to this browser's own localStorage. Skips firing for the
  // very first post-hydration render (nothing actually changed — it's the
  // freshly loaded value) via `initializedRef`, so hydrating a profile
  // never immediately re-PUTs the exact same value straight back.
  const lastSyncedRef = useRef<{ profilePhoto: string | null; bio: string } | null>(null)
  useEffect(() => {
    if (!userId || !hydrated) return
    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = { profilePhoto, bio }
      return
    }
    if (lastSyncedRef.current.profilePhoto === profilePhoto && lastSyncedRef.current.bio === bio) return
    lastSyncedRef.current = { profilePhoto, bio }
    fetch("/api/profile/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profilePhoto, bio }),
    }).catch(() => {
      // Best-effort — a network hiccup here just means this particular
      // edit doesn't reach the server; the cache above still has it
      // locally, and the next real edit's PUT carries the current value
      // again regardless.
    })
  }, [userId, hydrated, profilePhoto, bio])

  // Adds a post — persists server-side FIRST (so the id is the database's
  // own, not a client-generated one nothing server-side recognizes), then
  // reflects it locally. Throws on failure so MyProfileSheet.tsx's caller
  // can decide how to handle it rather than silently pretending it saved.
  const addPost = useCallback(
    async (dataUrl: string) => {
      const res = await fetch("/api/profile/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      })
      if (!res.ok) throw new Error(`failed to add post: ${res.status}`)
      const { post }: { post: Post } = await res.json()
      setPosts((prev) => [post, ...prev])
    },
    []
  )

  const removePost = useCallback(async (postId: string) => {
    const res = await fetch(`/api/profile/posts/${encodeURIComponent(postId)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`failed to remove post: ${res.status}`)
    setPosts((prev) => prev.filter((post) => post.id !== postId))
  }, [])

  return {
    handle,
    /** Whether this account's profile has actually finished loading (localStorage cache, then the server round trip — see this hook's own doc comment) — false for the brief gap while `userId` is known but its data hasn't loaded yet, and while nothing is loaded at all (signed out). MatchStage waits for this before treating onboarding/realtime as ready to evaluate, so it never judges "has a username" from fields that are still mid-reset to blank. */
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
    addPost,
    removePost,
  }
}
