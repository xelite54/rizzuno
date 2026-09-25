"use client"

import { useState } from "react"
import { AnimatePresence } from "motion/react"
import { ExpandIcon } from "@/components/icons"
import { UserAvatar, useCurrentPhoto } from "@/components/UserAvatar"
import { ProfilePhotoViewer } from "./ProfilePhotoViewer"

/**
 * The large avatar at the top of another user's full-screen profile —
 * their current photo (tap to enlarge) or the initial-letter fallback. With
 * `username`, the server's current photo (lib/currentPhotos) wins over the
 * `photo` passed in; a photo that fails to load (e.g. /api/media answering
 * 403/404/503) falls back to the initial rather than leaving an empty circle.
 */
export function ProfileAvatar({ photo, identity, username }: { photo: string | null; identity: string; username?: string | null }) {
  const [enlarged, setEnlarged] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const current = useCurrentPhoto(username, photo)
  const src = username ? current : photo
  if (!src || failedSrc === src) {
    return <UserAvatar name={identity} className="h-24 w-24 text-[32px]" />
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label={`Enlarge ${identity}'s profile photo`}
        className="group relative h-24 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- moderated user profile photo */}
        <img src={src} alt="" onError={() => { setFailedSrc(src); setEnlarged(false) }} className="h-full w-full rounded-full object-cover" />
        <span className="absolute inset-0 rounded-full bg-black/0 transition group-hover:bg-black/20" />
        <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white">
          <ExpandIcon className="h-3 w-3" />
        </span>
      </button>
      <AnimatePresence>
        {enlarged && <ProfilePhotoViewer photo={src} owner={identity} onClose={() => setEnlarged(false)} />}
      </AnimatePresence>
    </>
  )
}
