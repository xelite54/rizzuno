"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { CloseIcon } from "@/components/icons"

/**
 * Full-screen, enlarged view of someone else's profile photo — the avatar
 * equivalent of PostGallery.tsx's own photo viewer (same `<dialog>`/focus/
 * animation pattern), just for the single circular photo shown at the top
 * of a friend/peer/search-result profile rather than one of many posts.
 * Only ever opened from a photo that's actually there — the initial-letter
 * placeholder shown when someone has no photo yet is never clickable.
 */
export function ProfilePhotoViewer({ photo, owner, onClose }: { photo: string; owner: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    closeRef.current?.focus()
    return () => {
      dialog?.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-label={`${owner}'s profile photo`}
      onCancel={(event) => { event.preventDefault(); setClosing(true) }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden border-0 bg-transparent p-0 text-white backdrop:bg-transparent"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        onAnimationComplete={() => { if (closing) onClose() }}
        className="flex h-full flex-col bg-[#0c0a0f]/98 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-10"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 pb-5">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium tracking-[-0.01em]">{owner}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/40">Profile photo</p>
          </div>
          <button ref={closeRef} type="button" onClick={() => setClosing(true)} aria-label="Close photo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/80 transition hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        <motion.figure
          initial={{ scale: reduceMotion ? 1 : 0.975, y: reduceMotion ? 0 : 8 }}
          animate={{ scale: closing && !reduceMotion ? 0.985 : 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- moderated/local profile-photo data URL */}
          <img src={photo} alt={`${owner}'s profile photo`} className="h-full w-full object-contain" />
        </motion.figure>
      </motion.div>
    </dialog>
  )
}
