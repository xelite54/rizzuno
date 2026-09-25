"use client"

import { useState } from "react"
import { AnimatePresence } from "motion/react"
import { ExpandIcon } from "@/components/icons"
import { ProfilePhotoViewer } from "./ProfilePhotoViewer"

/** The large avatar at the top of another user's profile — their photo (tap to enlarge) or the initial-letter fallback. */
export function ProfileAvatar({ photo, identity }: { photo: string | null; identity: string }) {
  const [enlarged, setEnlarged] = useState(false)
  if (!photo) {
    return (
      <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-accent-2 text-[30px] font-semibold text-accent-foreground">
        {identity.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label={`Enlarge ${identity}'s profile photo`}
        className="group relative h-24 w-24 cursor-zoom-in overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- moderated user profile photo */}
        <img src={photo} alt="" className="h-full w-full rounded-full object-cover" />
        <span className="absolute inset-0 rounded-full bg-black/0 transition group-hover:bg-black/20" />
        <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white">
          <ExpandIcon className="h-3 w-3" />
        </span>
      </button>
      <AnimatePresence>
        {enlarged && <ProfilePhotoViewer photo={photo} owner={identity} onClose={() => setEnlarged(false)} />}
      </AnimatePresence>
    </>
  )
}
