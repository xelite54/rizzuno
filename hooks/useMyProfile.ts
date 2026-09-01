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
  /** See CURRENT_MIGRATION_VERSION's own doc comment. */
  serverProfileMigrationVersion?: number
}

type ServerProfile = { username: string | null; profilePhoto: string | null; bio: string; posts: Post[] }

const STORAGE_PREFIX = "rizzuno:profile:"

/**
 * Thrown by updateProfilePhoto()/addPost() when the server's response was
 * specifically a moderation rejection (see lib/imageModeration) — never
 * for any other kind of failure, which callers get as a plain Error
 * instead. `unavailable` distinguishes "the provider couldn't be reached/
 * timed out" (worth a retry) from a real content rejection (retrying the
 * exact same image won't help) — see components/match/MyProfileSheet.tsx,
 * which is the only place this ever surfaces to a person, as one of
 * exactly two messages: "Image not allowed" or "Couldn't check image —
 * try again". No provider/category/score detail is ever attached to this,
 * on purpose — this file never even learns any of that; the server
 * response it's built from doesn't carry it either.
 */
export class ImageModerationRejectedError extends Error {
  constructor(public readonly unavailable: boolean) {
    super(unavailable ? "moderation_unavailable" : "moderation_blocked")
    this.name = "ImageModerationRejectedError"
  }
}

/** Inspects a failed fetch Response for the two moderation-specific error codes app/api/profile/me and app/api/profile/posts return; throws ImageModerationRejectedError for those, a plain Error (with the HTTP status) for anything else. */
async function throwForFailedImageUpload(res: Response, action: string): Promise<never> {
  const body: { error?: string } = await res.json().catch(() => ({}))
  if (body.error === "moderation_blocked") throw new ImageModerationRejectedError(false)
  if (body.error === "moderation_unavailable") throw new ImageModerationRejectedError(true)
  throw new Error(`${action}: ${res.status}`)
}

/**
 * Bumped only if the backfill logic below ever needs to run again for
 * everyone (it shouldn't). Gates the ENTIRE one-time
 * localStorage-to-server backfill, independently of whatever
 * photo/bio/posts actually look like on a given load — this is what makes
 * "already migrated, then genuinely deleted all your posts later" behave
 * correctly. Without this marker, evaluating server-emptiness on every
 * load would look identical to "never migrated" in both cases, and a
 * later intentional deletion would get silently un-done by re-uploading
 * whatever stale posts this one browser's cache still happened to have.
 * Once a browser+account pair has completed migration (or determined none
 * was needed) at this version, it's never attempted again, ever, by this
 * browser for this account.
 */
const CURRENT_MIGRATION_VERSION = 1

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
 * except for a one-time backfill (gated by CURRENT_MIGRATION_VERSION, see
 * its own doc comment): each of profilePhoto/bio/posts is checked and
 * migrated INDEPENDENTLY — a pre-migration account might already have a
 * photo saved without that meaning its posts don't ALSO still need
 * migrating. Requiring the whole profile to be empty before backfilling
 * anything was the bug: a friend's photo/bio could show up while their
 * genuinely-existing posts silently never did, because the mere presence
 * of a migrated photo made the check believe there was nothing left to
 * migrate.
 *
 * profilePhoto and posts both go through server-side moderation now (see
 * lib/imageModeration) — every image this browser ever sends to
 * app/api/profile/me or app/api/profile/posts (including this file's own
 * migration backfill of old, pre-moderation local content) is subject to
 * it exactly the same way, no exceptions.
 */
export function useMyProfile() {
  const { data: session, status: sessionStatus } = useSession()
  const userId = session?.user?.id ?? ""

  const [profilePhoto, setProfilePhotoState] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [gender, setGender] = useState<Gender | null>(null)
  const [bio, setBio] = useState("")
  const [posts, setPosts] = useState<Post[]>([])
  const [migrationVersion, setMigrationVersion] = useState(0)
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
    setProfilePhotoState(null)
    setUsername("")
    setGender(null)
    setBio("")
    setPosts([])
    setMigrationVersion(0)
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
      let cachedPhoto: string | null = null
      let cachedBio = ""
      let cachedPosts: Post[] = []
      let cachedMigrationVersion = 0
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + userId)
        if (raw) {
          const stored = JSON.parse(raw) as Partial<StoredProfile>
          if (cancelled) return
          cachedPhoto = stored.profilePhoto ?? null
          cachedBio = stored.bio ?? ""
          cachedPosts = stored.posts ?? []
          cachedGender = stored.gender ?? null
          cachedMigrationVersion = stored.serverProfileMigrationVersion ?? 0
          setProfilePhotoState(cachedPhoto)
          if (stored.username) setUsername(stored.username)
          setGender(cachedGender)
          setBio(cachedBio)
          setPosts(cachedPosts)
        }
      } catch {
        // Corrupt or unavailable storage — start fresh rather than crash.
      }
      if (cancelled) return
      setMigrationVersion(cachedMigrationVersion)

      // 2) The server is now the actual source of truth for username/
      // profilePhoto/bio/posts (see this hook's own doc comment) — always
      // fetch and let it win, not just when the cache was empty, so a
      // change made from another device is picked up here too.
      try {
        const res = await fetch("/api/profile/me")
        if (!cancelled && res.ok) {
          const data: ServerProfile = await res.json()
          if (data.username) setUsername(data.username)
          setProfilePhotoState(data.profilePhoto)
          setBio(data.bio)
          setPosts(data.posts)

          if (cachedMigrationVersion < CURRENT_MIGRATION_VERSION) {
            // Each field's own, INDEPENDENT check — never require all
            // three to be empty before backfilling any one of them (see
            // this hook's own doc comment for exactly why that was wrong).
            const photoNeeded = !data.profilePhoto && Boolean(cachedPhoto)
            const bioNeeded = !data.bio && cachedBio.length > 0
            const postsNeeded = data.posts.length === 0 && cachedPosts.length > 0
            const migrationNeeded = photoNeeded || bioNeeded || postsNeeded

            console.log("profile post migration", {
              cachedPostCount: cachedPosts.length,
              serverPostCount: data.posts.length,
              migrationNeeded,
            })

            let migrationSucceeded = true

            // Photo and bio are sent as two SEPARATE requests, never
            // bundled — the same reason app/api/profile/me's PUT handler
            // documents: a photo that a real content policy now rejects
            // (it never went through moderation when it was first saved,
            // pre-migration) must never also block an unrelated bio
            // backfill, and vice versa.
            if (photoNeeded) {
              try {
                const putRes = await fetch("/api/profile/me", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ profilePhoto: cachedPhoto }),
                })
                if (!putRes.ok) {
                  console.error("profile migration: photo backfill failed", { status: putRes.status })
                  migrationSucceeded = false
                }
              } catch {
                console.error("profile migration: photo backfill threw a network error")
                migrationSucceeded = false
              }
            }

            if (bioNeeded) {
              try {
                const putRes = await fetch("/api/profile/me", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ bio: cachedBio }),
                })
                if (!putRes.ok) {
                  console.error("profile migration: bio backfill failed", { status: putRes.status })
                  migrationSucceeded = false
                }
              } catch {
                console.error("profile migration: bio backfill threw a network error")
                migrationSucceeded = false
              }
            }

            if (postsNeeded) {
              // Sequential and awaited, not fire-and-forget — a client
              // that raced ahead without waiting could never tell a real
              // upload failure (including a moderation rejection) apart
              // from success, and had no way to know when it was actually
              // safe to mark migration complete. Oldest first, so the
              // final server-side order (each insert is newest-first)
              // ends up matching what was already cached; stops at the
              // first failure rather than silently uploading the rest out
              // of order.
              for (const post of [...cachedPosts].reverse()) {
                try {
                  const postRes = await fetch("/api/profile/posts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dataUrl: post.dataUrl }),
                  })
                  if (!postRes.ok) {
                    console.error("profile migration: a post backfill upload failed", { status: postRes.status })
                    migrationSucceeded = false
                    break
                  }
                } catch {
                  console.error("profile migration: a post backfill upload threw a network error")
                  migrationSucceeded = false
                  break
                }
              }
            }

            if (migrationNeeded && migrationSucceeded) {
              // Re-fetch so React state (and what gets cached locally
              // right after) holds the CANONICAL database rows — real,
              // server-generated post ids, not the client-generated
              // crypto.randomUUID() ones a pre-migration post was created
              // with, which the server has never heard of.
              try {
                const finalRes = await fetch("/api/profile/me")
                if (!cancelled && finalRes.ok) {
                  const finalData: ServerProfile = await finalRes.json()
                  setProfilePhotoState(finalData.profilePhoto)
                  setBio(finalData.bio)
                  setPosts(finalData.posts)
                }
              } catch {
                // The uploads themselves already succeeded — state just
                // won't reflect the canonical ids until the next reload.
              }
            }

            // Marked complete only if nothing needed backfilling in the
            // first place, or everything that did succeeded — never if a
            // photo/bio/post upload actually failed (moderation rejection
            // included), so a real failure gets a genuine retry on the
            // next load instead of being permanently (and silently) given
            // up on. A moderation-rejected pre-migration photo/post is a
            // real, deliberate rejection though, not a transient failure —
            // it will keep "failing" (correctly) on every future load
            // until the offending content is removed client-side; that's
            // the intended behavior, not a bug to work around here.
            if (!cancelled && (!migrationNeeded || migrationSucceeded)) {
              setMigrationVersion(CURRENT_MIGRATION_VERSION)
            }
          }
        }
      } catch {
        // Network hiccup fetching the profile itself — keep whatever the
        // cache provided; this whole load (backfill included) effectively
        // retries on the next mount/account-switch.
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
  // updateProfilePhoto()/the bio auto-sync effect below are what actually
  // persist those two fields server-side.
  useEffect(() => {
    if (!userId || !hydrated) return
    const stored: StoredProfile = {
      profilePhoto,
      username,
      gender,
      bio,
      posts,
      serverProfileMigrationVersion: migrationVersion,
    }
    try {
      window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(stored))
    } catch {
      // Storage full or unavailable — this save just won't stick.
    }
  }, [userId, hydrated, profilePhoto, username, gender, bio, posts, migrationVersion])

  // Persists bio to the server whenever it actually changes post-hydration
  // — this is what makes MyProfileSheet.tsx's existing `setBio(editBioDraft)`
  // call (unchanged call site) actually reach Postgres instead of only
  // ever writing to this browser's own localStorage. Text only, never
  // moderated (see lib/imageModeration — images only) — profilePhoto is
  // deliberately NOT part of this optimistic-sync effect; see
  // updateProfilePhoto() below for why that one has to be awaited and
  // server-first instead. Skips firing for the very first post-hydration
  // render (nothing actually changed — it's the freshly loaded value), so
  // hydrating a profile never immediately re-PUTs the exact same value
  // straight back.
  const lastSyncedBioRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userId || !hydrated) return
    if (lastSyncedBioRef.current === null) {
      lastSyncedBioRef.current = bio
      return
    }
    if (lastSyncedBioRef.current === bio) return
    lastSyncedBioRef.current = bio
    fetch("/api/profile/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio }),
    }).catch(() => {
      // Best-effort — a network hiccup here just means this particular
      // edit doesn't reach the server; the cache above still has it
      // locally, and the next real edit's PUT carries the current value
      // again regardless.
    })
  }, [userId, hydrated, bio])

  // Sets a new profile photo (or `null` to remove one) — server-FIRST,
  // unlike a plain setState: the whole point of moderation is that a
  // rejected image must never become visible, even briefly, so this
  // cannot optimistically apply the new photo before the server has
  // actually confirmed it. Throws ImageModerationRejectedError (or a
  // plain Error for any other failure) instead of applying anything —
  // the existing photo in state/localStorage/the database is left exactly
  // as it was. Removing a photo (`null`) skips moderation server-side
  // (see app/api/profile/me's PUT) and this never throws for that case
  // except on a genuine network/server error.
  const updateProfilePhoto = useCallback(async (photo: string | null) => {
    const res = await fetch("/api/profile/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profilePhoto: photo }),
    })
    if (!res.ok) await throwForFailedImageUpload(res, "failed to update profile photo")
    setProfilePhotoState(photo)
  }, [])

  // Adds a post — persists (and gets moderated) server-side FIRST, so the
  // id is the database's own, not a client-generated one nothing
  // server-side recognizes, and so a rejected image is never reflected in
  // local state at all. Throws ImageModerationRejectedError (or a plain
  // Error for any other failure) so MyProfileSheet.tsx's caller can show
  // "Image not allowed" / "Couldn't check image — try again" rather than
  // silently pretending it saved.
  const addPost = useCallback(async (dataUrl: string) => {
    const res = await fetch("/api/profile/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    })
    if (!res.ok) await throwForFailedImageUpload(res, "failed to add post")
    const { post }: { post: Post } = await res.json()
    setPosts((prev) => [post, ...prev])
  }, [])

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
    /** Server-first and moderated — see this function's own doc comment. Replaces the old plain setProfilePhoto setter. */
    updateProfilePhoto,
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
