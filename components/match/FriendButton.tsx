"use client"

import { AnimatePresence, motion } from "motion/react"
import { CheckIcon } from "@/components/icons"
import { EASE_OUT, DURATION_QUICK } from "@/lib/motion"

export type FriendState = "none" | "requested" | "friends"

type FriendButtonProps = {
  state: FriendState
  onAdd: () => void
  /** "compact" (default) is the small inline pill next to a name — "large" is the full-width button used on a full-screen profile, matching the Friends search result's "Add friend" button. */
  variant?: "compact" | "large"
}

/**
 * Add → Requested → Friend. Sends instantly on click, no confirmation modal.
 *
 * "None" and "requested" stay the same button element (key="action") rather
 * than swapping components — only the label crossfades and the colors ease
 * across, so clicking "Add" doesn't look like the button broke or got
 * replaced. "Friends" is a genuinely different, non-interactive shape, so
 * that one still gets a full in/out transition.
 */
export function FriendButton({ state, onAdd, variant = "compact" }: FriendButtonProps) {
  if (variant === "large") {
    return (
      <AnimatePresence mode="wait" initial={false}>
        {state === "friends" ? (
          <motion.span
            key="friends"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-online"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Friend
          </motion.span>
        ) : (
          <motion.button
            key="action"
            type="button"
            onClick={onAdd}
            disabled={state === "requested"}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            aria-label={state === "requested" ? "Friend request sent" : "Add friend"}
            className={`w-full rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
              state === "requested"
                ? "border border-border text-muted"
                : "bg-accent text-accent-foreground hover:brightness-110"
            }`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={state}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
                className="block"
              >
                {state === "requested" ? "Requested" : "Add friend"}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === "friends" ? (
        <motion.span
          key="friends"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
          className="flex shrink-0 items-center gap-1 rounded-full bg-online/15 px-2.5 py-1 text-[11px] font-medium text-online"
        >
          <CheckIcon className="h-2.5 w-2.5" />
          Friend
        </motion.span>
      ) : (
        <motion.button
          key="action"
          type="button"
          onClick={onAdd}
          disabled={state === "requested"}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
          aria-label={state === "requested" ? "Friend request sent" : "Add friend"}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 active:scale-95 ${
            state === "requested" ? "bg-white/10 text-muted" : "bg-white/15 text-foreground hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={state}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
              className="block"
            >
              {state === "requested" ? "Requested" : "Add"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
