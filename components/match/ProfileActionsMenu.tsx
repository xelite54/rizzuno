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
  /**
   * Where the dropdown hangs off the trigger — "end" (the default) pins it
   * to the trigger's right edge, for a trigger sitting at the right end of
   * a row (a sheet header). "center" hangs it centered under the trigger
   * instead, for a trigger sitting inline next to a name/username, in the
   * middle of a centered profile layout, where anchoring to an edge would
   * float the dropdown off to one side.
   */
  align?: "end" | "center"
  /** Smaller trigger (28px vs. the 44px default) for sitting inline next to a name/username instead of alone in a header row. */
  compact?: boolean
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
export function ProfileActionsMenu({ ariaLabel, children, onClose, align = "end", compact = false }: ProfileActionsMenuProps) {
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
        className={`flex shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
          compact ? "h-7 w-7" : "h-11 w-11"
        } ${open ? "bg-surface-2 text-foreground" : ""}`}
      >
        <DotsIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className={`absolute top-full z-10 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 text-left shadow-xl ${
              align === "center" ? "left-1/2 -translate-x-1/2" : "right-0"
            }`}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
