"use client"

import { AnimatePresence, motion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import { FriendButton } from "./FriendButton"
import type { FriendState } from "./FriendButton"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"

type PeerProfileSheetProps = {
  peer: PeerProfile | null
  open: boolean
  friendState: FriendState
  onAddFriend: () => void
  onClose: () => void
}

// Spec §21/6: the full profile page for the person you're matched with —
// same page format as "My profile" (full-page slide-in, avatar, posts), just
// read-only: there's no editing and no post data for someone else yet. Slides
// in from the right so it reads as "their side," opposite My Profile's left
// slide-in. The video connection keeps running underneath.
export function PeerProfileSheet({ peer, open, friendState, onAddFriend, onClose }: PeerProfileSheetProps) {
  if (!peer) return null

  // One identity, not two — their chosen username if they have one, their
  // random handle otherwise, never both. No "@" — keeps the design plain.
  const identity = peer.username ?? peer.handle

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "100%" }}
          transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
          className="fixed inset-0 z-50 flex flex-col bg-surface"
        >
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-4">
            <span className="flex-1 text-[15px] font-semibold text-foreground">Profile</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-lg px-6 py-6">
              <div className="flex flex-col items-center text-center">
                <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-accent-2 text-[30px] font-semibold text-accent-foreground">
                  {peer.profilePhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
                    <img src={peer.profilePhoto} alt="" className="h-full w-full object-cover" />
                  ) : (
                    identity.charAt(0).toUpperCase()
                  )}
                </span>
                <p className="mt-3 text-[17px] font-semibold text-foreground">{identity}</p>

                {FRIENDS_ENABLED && (
                  <div className="mt-4 w-full max-w-xs">
                    <FriendButton state={friendState} onAdd={onAddFriend} variant="large" />
                  </div>
                )}
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
