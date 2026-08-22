"use client"

import { AnimatePresence, motion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_SLOW } from "@/lib/motion"
import type { PendingRequest } from "@/hooks/useFriends"

type IncomingFriendRequestToastProps = {
  request: PendingRequest | null
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onDismiss: () => void
  onViewProfile: () => void
}

/**
 * A live "someone sent you a friend request" notification — slides in from
 * the right in the top-right corner while a call is active, with Accept /
 * Decline right there. The same request also lands in the Friends panel's
 * inbox, so this is just an earlier, faster way to see it.
 */
export function IncomingFriendRequestToast({
  request,
  onAccept,
  onDecline,
  onDismiss,
  onViewProfile,
}: IncomingFriendRequestToastProps) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 48 }}
          transition={{ duration: DURATION_SLOW, ease: EASE_OUT }}
          className="fixed right-4 top-16 z-[70] w-72 overflow-hidden rounded-2xl border border-border bg-surface p-3.5 shadow-2xl"
        >
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              onClick={onViewProfile}
              aria-label={`View ${request.displayName}'s profile`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[14px] font-semibold text-accent-foreground"
            >
              {request.displayName.charAt(0)}
            </button>
            <div className="min-w-0 flex-1">
              <button type="button" onClick={onViewProfile} className="block max-w-full text-left">
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {request.displayName}
                </span>
                <span className="block truncate text-[11px] text-muted">@{request.username}</span>
              </button>
              <p className="mt-1 text-[12px] text-muted">sent you a friend request</p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onDecline(request.id)}
              className="flex-1 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => onAccept(request.id)}
              className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
            >
              Accept
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
