"use client"

import { UserAvatar } from "@/components/UserAvatar"
import { AnimatePresence, motion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_SLOW } from "@/lib/motion"
import type { PendingRequest } from "@/hooks/useFriends"

type IncomingFriendRequestToastProps = {
  /** At most MAX_FRIEND_REQUEST_TOASTS, each shown once ever (see lib/friendRequestNotifications.ts). */
  requests: PendingRequest[]
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onDismiss: (id: string) => void
  onViewProfile: (request: PendingRequest) => void
}

/**
 * Live "someone sent you a friend request" notifications, stacked in the
 * top-right corner with Accept / Decline right there. Every request also
 * lands in the Friends panel's inbox (mail), which is where it stays once
 * dismissed, and where any beyond the on-screen limit go directly.
 */
export function IncomingFriendRequestToast({
  requests,
  onAccept,
  onDecline,
  onDismiss,
  onViewProfile,
}: IncomingFriendRequestToastProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[70] flex w-72 flex-col gap-2">
      <AnimatePresence initial={false}>
        {requests.map((request) => (
          <motion.div
            key={request.id}
            layout
            role="alert"
            initial={{ opacity: 0, x: 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 48 }}
            transition={{ duration: DURATION_SLOW, ease: EASE_OUT }}
            className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-border bg-surface p-3.5 shadow-2xl"
          >
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => onViewProfile(request)}
                aria-label={`View ${request.displayName}'s profile`}
                className="shrink-0 rounded-full"
              >
                <UserAvatar name={request.displayName} username={request.username || null} photo={request.profilePhoto} className="h-10 w-10 text-[14px]" />
              </button>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onViewProfile(request)} className="block max-w-full text-left">
                  <span className="block truncate text-[13px] font-semibold text-foreground">
                    {request.displayName}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{request.username}</span>
                </button>
                <p className="mt-1 text-[12px] text-muted">sent you a friend request</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(request.id)}
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
        ))}
      </AnimatePresence>
    </div>
  )
}
