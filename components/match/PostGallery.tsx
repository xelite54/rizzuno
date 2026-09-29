"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { DotsIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"
import { ReportDialog } from "@/components/report/ReportDialog"
import { PostViewer, type ViewerPost } from "./PostViewer"

/** Per-post safety actions — only passed for someone else's posts, never the viewer's own. */
export type PostActions = { onBlockOwner?: () => void }

/** Only receives posts the profile endpoint has already authorized. */
export function PostGallery({ posts, owner, actions }: { posts: ViewerPost[]; owner: string; actions?: PostActions }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reportPostId, setReportPostId] = useState<string | null>(null)
  const selectedIndex = posts.findIndex((post) => post.id === selectedId)

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {posts.map((post, index) => (
          <div key={post.id} className="relative">
            <button type="button" data-post-tile="" onClick={() => setSelectedId(post.id)} aria-label={`Enlarge photo ${index + 1} by ${owner}`} className="group block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface-2 transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- authorized profile-post data URL */}
              <img src={post.dataUrl} alt={`Photo ${index + 1} by ${owner}`} className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.035]" />
            </button>
            {actions && <PostMenu label={`More options for photo ${index + 1} by ${owner}`} owner={owner} onReport={() => setReportPostId(post.id)} onBlock={actions.onBlockOwner} />}
          </div>
        ))}
      </div>
      {selectedIndex >= 0 && <PostViewer posts={posts} index={selectedIndex} owner={owner} onIndexChange={(index) => setSelectedId(posts[index].id)} onClose={() => setSelectedId(null)} />}
      {actions && <ReportDialog open={!!reportPostId} target={{ type: "post", id: reportPostId ?? "" }} onClose={() => setReportPostId(null)} />}
    </>
  )
}

function PostMenu({ label, owner, onReport, onBlock }: { label: string; owner: string; onReport: () => void; onBlock?: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); setConfirmBlock(false) }

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) { setOpen(false); setConfirmBlock(false) }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  const item = "w-full rounded-xl px-3 py-2 text-left text-[13px] hover:bg-surface-2"
  return (
    <div ref={rootRef} className="absolute right-1.5 top-1.5 z-10">
      <button type="button" aria-label={label} onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white/90 transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
        <DotsIcon className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl border border-border bg-surface p-1.5 text-left shadow-xl"
          >
            {confirmBlock ? (
              <div className="px-1.5 py-1">
                <p className="mb-2 text-[12px] leading-snug text-muted">Block {owner}? They won&apos;t be able to contact you, and their profile will be hidden from you.</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setConfirmBlock(false)} className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">Cancel</button>
                  <button type="button" onClick={() => { close(); onBlock?.() }} className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110">Block</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                <button type="button" onClick={() => { close(); onReport() }} className={`${item} text-danger`}>Report post</button>
                {onBlock && <button type="button" onClick={() => setConfirmBlock(true)} className={`${item} text-danger`}>Block user</button>}
                <button type="button" onClick={close} className={`${item} text-muted`}>Cancel</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
