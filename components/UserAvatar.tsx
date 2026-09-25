"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { currentPhotosVersion, knownPhoto, requestCurrentPhoto, subscribeCurrentPhotos } from "@/lib/currentPhotos"

/**
 * Another user's current photo: the server's answer (via lib/currentPhotos)
 * once known, the caller's snapshot only until then. `null` = show the initial.
 */
export function useCurrentPhoto(username: string | null | undefined, snapshot?: string | null): string | null {
  useSyncExternalStore(subscribeCurrentPhotos, currentPhotosVersion, currentPhotosVersion)
  useEffect(() => {
    requestCurrentPhoto(username)
    // Returning to the tab re-checks anything older than STALE_MS.
    const onVisible = () => { if (document.visibilityState === "visible") requestCurrentPhoto(username) }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [username])
  const known = knownPhoto(username)
  return known !== undefined ? known : snapshot || null
}

type UserAvatarProps = {
  /** Display name used for the initial fallback and accessible label. */
  name: string
  /** Username to resolve the current server photo for; omit to use `photo` as-is. */
  username?: string | null
  /** Snapshot photo shown until the server's current one is known. */
  photo?: string | null
  /** Size, text size and any shape overrides — e.g. "h-9 w-9 text-[13px]". */
  className?: string
  /** Background/text colors behind the initial. */
  tone?: string
}

/**
 * The one avatar used for other people everywhere in the app: their current
 * photo, or the username initial when there is none, it was removed, or the
 * image fails to load — never an empty circle.
 */
export function UserAvatar({ name, username, photo, className = "h-10 w-10 text-[13px]", tone = "bg-accent-2 font-semibold text-accent-foreground" }: UserAvatarProps) {
  const current = useCurrentPhoto(username, photo)
  const src = username === undefined ? photo || null : current
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showPhoto = !!src && failedSrc !== src
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${tone} ${className}`}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- moderated user profile photo served from /api/media
        <img src={src} alt="" onError={() => setFailedSrc(src)} className="h-full w-full object-cover" />
      ) : (
        (name || username || "?").charAt(0).toUpperCase()
      )}
    </span>
  )
}
