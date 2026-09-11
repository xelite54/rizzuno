"use client"
import panelStyles from "./SocialPanel.module.css"
import { PublicProfilePosts } from "./PublicProfilePosts"
import { ReportButton } from "./ReportButton"
import { ProfileActionsMenu } from "./ProfileActionsMenu"

import { AnimatePresence, motion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import type { PendingRequest } from "@/hooks/useFriends"
import type { ReportCategory } from "@/lib/signaling/protocol"

type RequestProfileSheetProps = {
  request: PendingRequest | null
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onReport: (userId: string, category: ReportCategory) => void
  onClose: () => void
}

/**
 * Full-screen profile for someone who has sent YOU a friend request —
 * Decline/Accept, not an outgoing "Add" — used when opening a request's
 * profile straight from the live in-call toast.
 */
export function RequestProfileSheet({ request, onAccept, onDecline, onReport, onClose }: RequestProfileSheetProps) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`${request.displayName}'s profile`}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
          className={`${panelStyles.panel} fixed inset-0 z-[70] flex flex-col bg-surface`}
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

          <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-2 text-[32px] font-semibold text-accent-foreground">
              {request.displayName.charAt(0)}
            </span>
            <div className="mt-4 flex items-center gap-1">
              <p className="text-[18px] font-semibold text-foreground">{request.displayName}</p>
              <ProfileActionsMenu ariaLabel={`More options for ${request.displayName}`} align="center" compact>
                {(closeMenu) => (
                  <ReportButton
                    onReport={(category) => onReport(request.senderId, category)}
                    onSubmitted={() => setTimeout(closeMenu, 1100)}
                    triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                  />
                )}
              </ProfileActionsMenu>
            </div>
            <p className="mt-2 text-[12px] text-muted">Wants to be friends</p>

            <div className="mt-6 flex w-full max-w-xs gap-2">
              <button
                type="button"
                onClick={() => onDecline(request.id)}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => onAccept(request.id)}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110"
              >
                Accept
              </button>
            </div>

            <div className="mt-8 w-full max-w-lg">
              <PublicProfilePosts key={request.username} username={request.username} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
