"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import type { MatchInvitation } from "@/lib/signaling/protocol"
import panelStyles from "./SocialPanel.module.css"

type Props = {
  invitation: MatchInvitation | null
  canAccept: boolean
  error: string | null
  onRespond: (id: string, accept: boolean) => void
  onDismiss: (id: string) => void
}

export function IncomingMatchInvitationToast({ invitation, canAccept, error, onRespond, onDismiss }: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {invitation && (
        <motion.div
          key={invitation.id}
          role="alert"
          aria-label="Incoming match invitation"
          initial={{ opacity: 0, y: reducedMotion ? 0 : -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -12 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className={`${panelStyles.panel} fixed right-4 top-4 z-[80] w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-4 shadow-2xl`}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-2 text-[15px] font-semibold text-white" aria-hidden="true">
              {invitation.username.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="truncate text-[14px] font-semibold text-foreground">@{invitation.username}</p>
              <p className="mt-1 text-[13px] text-muted">Wants to match with you</p>
            </div>
            <button type="button" onClick={() => onDismiss(invitation.id)} aria-label="Dismiss match invitation notification" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onRespond(invitation.id, false)} className="h-11 rounded-xl border border-border text-[13px] font-medium text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">Decline</button>
            <button type="button" disabled={!canAccept} onClick={() => onRespond(invitation.id, true)} className="h-11 rounded-xl bg-foreground text-[13px] font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40">Accept &amp; match</button>
          </div>
          {!canAccept && <p className="mt-3 text-[12px] text-muted">Return home with video available to accept.</p>}
          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
