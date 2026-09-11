"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { DotsIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"

type ProfileActionsMenuProps = {
  ariaLabel: string
  /** Rendered inside the open dropdown; `close` lets a completed action (or its own Cancel) dismiss the menu without each caller re-deriving its own open/close state. */
  children: (close: () => void) => React.ReactNode
  /** Fired whenever the menu transitions to closed — by the "•••" toggle, or by a child calling `close()`. Lets a caller reset its own confirm-step state (Unfriend/Block's "are you sure?") so reopening the menu always starts back at the top level rather than wherever it was left. */
  onClose?: () => void
}

/**
 * The "•••" trigger + dropdown used on a full-profile sheet (friend,
 * search result, incoming request) to hold secondary/destructive actions —
 * Unfriend, Block, Report — off the main body, the same way the friends
 * LIST already tucks its own row actions behind a "•••" (see the
 * `rowMenuFriendId` dropdown in FriendsPanel.tsx, which this mirrors but
 * as a standalone component since it's now reused across several profile
 * sheets). Not to be confused with ProfileMenu.tsx — that's the header's
 * own-account avatar button, an unrelated single-purpose control.
 */
export function ProfileActionsMenu({ ariaLabel, children, onClose }: ProfileActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
    onClose?.()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={ariaLabel}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
          open ? "bg-surface-2 text-foreground" : ""
        }`}
      >
        <DotsIcon className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="absolute right-0 top-12 z-10 w-56 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
