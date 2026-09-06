"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { CloseIcon } from "@/components/icons"

type Post = { id: string; dataUrl: string }

function PhotoViewer({ post, owner, number, total, onClose }: { post: Post; owner: string; number: number; total: number; onClose: () => void }) {
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
      aria-label={`Photo ${number} of ${total} by ${owner}`}
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
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/40">Photo</p>
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
          {/* eslint-disable-next-line @next/next/no-img-element -- original authorized profile-post data URL */}
          <img src={post.dataUrl} alt={`Photo ${number} posted by ${owner}`} className="h-full w-full object-contain" />
        </motion.figure>
        <footer className="mx-auto mt-5 flex w-full max-w-6xl shrink-0 items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-[11px] tabular-nums tracking-[0.12em] text-white/45">{String(number).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        </footer>
      </motion.div>
    </dialog>
  )
}

/** Only receives posts the profile endpoint has already authorized. */
export function PostGallery({ posts, owner }: { posts: Post[]; owner: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = posts.findIndex((post) => post.id === selectedId)
  const selected = posts[selectedIndex]

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {posts.map((post, index) => (
          <button key={post.id} type="button" onClick={() => setSelectedId(post.id)} aria-label={`Enlarge photo ${index + 1} by ${owner}`} className="group aspect-square cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface-2 transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- authorized profile-post data URL */}
            <img src={post.dataUrl} alt={`Photo ${index + 1} by ${owner}`} className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.035]" />
          </button>
        ))}
      </div>
      {selected && <PhotoViewer key={selected.id} post={selected} owner={owner} number={selectedIndex + 1} total={posts.length} onClose={() => setSelectedId(null)} />}
    </>
  )
}
