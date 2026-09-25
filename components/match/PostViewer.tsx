"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { CloseIcon } from "@/components/icons"

export type ViewerPost = { id: string; dataUrl: string }

const SWIPE_THRESHOLD_PX = 50

/** Clamped previous/next index, or null at the boundary. */
export function neighborIndex(index: number, total: number, step: -1 | 1): number | null {
  const next = index + step
  return next >= 0 && next < total ? next : null
}

/** ArrowLeft/ArrowRight → previous/next while `enabled`; ignores typing in fields. */
export function usePostKeyboardNav(enabled: boolean, onPrevious: () => void, onNext: () => void) {
  const handlers = useRef({ onPrevious, onNext })
  useEffect(() => { handlers.current = { onPrevious, onNext } })
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (event.key === "ArrowLeft") { event.preventDefault(); handlers.current.onPrevious() }
      else if (event.key === "ArrowRight") { event.preventDefault(); handlers.current.onNext() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}

/** Horizontal swipe on touch/pen → previous/next. Returns pointer handlers plus a "was that a swipe?" check for click handlers. */
export function usePostSwipe(onPrevious: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  return {
    wasSwipe: () => { const value = swiped.current; swiped.current = false; return value },
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        swiped.current = false
        start.current = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY }
      },
      onPointerUp: (event: React.PointerEvent) => {
        const origin = start.current
        start.current = null
        if (!origin) return
        const dx = event.clientX - origin.x
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(event.clientY - origin.y)) return
        swiped.current = true
        if (dx > 0) onPrevious()
        else onNext()
      },
    },
  }
}

/** The `<` / `>` buttons. Hidden (and unfocusable) at the first/last post. */
export function PostNavArrow({ direction, disabled, onClick, className = "" }: { direction: "previous" | "next"; disabled: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick() }}
      disabled={disabled}
      aria-label={direction === "previous" ? "Previous post" : "Next post"}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/85 transition hover:border-white/35 hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:invisible ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
        <path d={direction === "previous" ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/**
 * The one full-screen post viewer for every profile's post grid. Controlled:
 * the parent owns which post is open (`index`) and the post order. Arrows,
 * ArrowLeft/ArrowRight and horizontal swipes move between posts; Escape,
 * the close button, or a click outside the image closes it.
 */
export function PostViewer({ posts, index, owner, onIndexChange, onClose }: {
  posts: ViewerPost[]
  index: number
  owner: string
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)
  const reduceMotion = useReducedMotion()
  const post = posts[index]
  const total = posts.length
  const previous = neighborIndex(index, total, -1)
  const next = neighborIndex(index, total, 1)
  const goPrevious = () => { if (previous !== null) onIndexChange(previous) }
  const goNext = () => { if (next !== null) onIndexChange(next) }
  const close = () => setClosing(true)
  const swipe = usePostSwipe(goPrevious, goNext)
  usePostKeyboardNav(!closing, goPrevious, goNext)

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

  // An arrow that just hid at a boundary would drop focus out of the dialog.
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLButtonElement && active.disabled) closeRef.current?.focus()
  }, [index])

  if (!post) return null
  const number = index + 1

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Photo ${number} of ${total} by ${owner}`}
      onCancel={(event) => { event.preventDefault(); close() }}
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
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/40">Photo</p>
          </div>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close photo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/80 transition hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        {/* Clicking the empty area around the image closes; the image, arrows and swipes don't. */}
        <div
          className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 touch-pan-y items-center justify-center"
          onClick={(event) => { if (!swipe.wasSwipe() && event.target === event.currentTarget) close() }}
          {...swipe.handlers}
        >
          <motion.figure
            key={post.id}
            initial={{ opacity: reduceMotion ? 1 : 0.4 }}
            animate={{ opacity: 1, scale: closing && !reduceMotion ? 0.985 : 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none flex h-full w-full items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authorized profile-post image */}
            <img src={post.dataUrl} alt={`Photo ${number} posted by ${owner}`} className="pointer-events-auto max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
          </motion.figure>
          {total > 1 && (
            <>
              <PostNavArrow direction="previous" disabled={previous === null} onClick={goPrevious} className="absolute left-0 top-1/2 -translate-y-1/2 sm:left-2" />
              <PostNavArrow direction="next" disabled={next === null} onClick={goNext} className="absolute right-0 top-1/2 -translate-y-1/2 sm:right-2" />
            </>
          )}
        </div>
        <footer className="mx-auto mt-5 flex w-full max-w-6xl shrink-0 items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-[11px] tabular-nums tracking-[0.12em] text-white/45">{String(number).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        </footer>
      </motion.div>
    </dialog>
  )
}
