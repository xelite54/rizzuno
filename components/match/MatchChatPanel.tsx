"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { containsBlockedChatContent, CHAT_BLOCKED_MESSAGE } from "@/lib/textFilter"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CloseIcon, SendIcon } from "@/components/icons"
import { isSameDay, formatDayLabel, formatTime } from "@/lib/chatFormat"
import { EASE_OUT, DURATION_QUICK, DURATION_BASE } from "@/lib/motion"
import type { ChatMessage, PeerProfile } from "@/hooks/useMatchmaking"

/** Shared with FriendsPanel.tsx — same "•••" typing indicator, just under a different chat surface. */
export function TypingDots() {
  const reduceMotion = useReducedMotion()
  return (
    <div role="status" aria-label="Typing" className="flex w-fit items-center gap-1 rounded-2xl bg-surface-2 px-3.5 py-3">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ y: reduceMotion ? 0 : [0, -4, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  )
}

type MatchChatPanelProps = {
  open: boolean
  onClose: () => void
  peer: PeerProfile | null
  messages: ChatMessage[]
  disabled: boolean
  peerTyping: boolean
  onSend: (text: string) => void
  onNotifyTyping: () => void
}

/**
 * A plain, ordinary chat panel — same bubble/timestamp/day-label look as
 * Friends' own chat (FriendsPanel.tsx), just floating above the chat icon
 * instead of sliding in from the edge, so this reads as "the same feature,
 * a different surface" rather than a separately-branded thing. Viewport
 * overlay: never clipped by the transformed mobile self-camera tile.
 */
export function MatchChatPanel({
  open,
  onClose,
  peer,
  messages,
  disabled,
  peerTyping,
  onSend,
  onNotifyTyping,
}: MatchChatPanelProps) {
  const [viewport, setViewport] = useState<{ height: number; bottom: number } | null>(null)
  const [draft, setDraft] = useState("")
  const [blocked, setBlocked] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [open, onClose])

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduceMotion ? "instant" : "smooth" })
  }, [open, messages, peerTyping, reduceMotion])

  useEffect(() => {
    if (!open) return
    const visual = window.visualViewport
    const update = () => setViewport({
      height: visual?.height ?? window.innerHeight,
      bottom: Math.max(0, window.innerHeight - (visual?.height ?? window.innerHeight) - (visual?.offsetTop ?? 0)),
    })
    update()
    visual?.addEventListener("resize", update)
    visual?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      visual?.removeEventListener("resize", update)
      visual?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [open])

  function submit() {
    if (disabled || !draft.trim()) return
    if (containsBlockedChatContent(draft)) {
      setBlocked(true)
      return
    }
    setBlocked(false)
    onSend(draft)
    setDraft("")
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close chat"
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION_QUICK, ease: EASE_OUT }}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <motion.div
            role="region"
            aria-label="Chat"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
            style={viewport ? { bottom: viewport.bottom + (viewport.bottom > 100 ? 12 : 64), maxHeight: Math.max(120, viewport.height - 88) } : undefined}
            className="fixed bottom-16 right-3 z-50 flex h-[460px] max-h-[70dvh] w-[350px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-xl"
          >
            <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-2 text-[12px] font-semibold text-accent-foreground">
                {peer?.profilePhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-provided profile image
                  <img src={peer.profilePhoto} alt="" className="h-full w-full object-cover" />
                ) : (peer?.username || peer?.handle || "?").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-foreground">{peer ? (peer.username ?? peer.handle) : "Chat"}</p>
                <p className="text-[11px] text-muted">{disabled ? "Waiting for a match" : "Online"}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div ref={listRef} role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3">
              {messages.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
                  <p className="text-[13px] font-medium text-foreground">No messages yet</p>
                  <p className="mt-1 text-[12px] text-muted">{disabled ? "Chat opens once you're matched." : "Say hi when you're ready."}</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const previous = messages[index - 1]
                  const showDayLabel = !previous || !isSameDay(new Date(previous.ts), new Date(message.ts))
                  const isMine = message.from === "me"
                  return (
                    <div key={message.id}>
                      {showDayLabel && (
                        <div className="my-2 flex justify-center">
                          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
                            {formatDayLabel(message.ts)}
                          </span>
                        </div>
                      )}
                      <div className={`max-w-[80%] ${isMine ? "ml-auto" : ""}`}>
                        {message.content.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local/data-URL chat images, not a static asset
                          <img
                            src={message.content.dataUrl}
                            alt="Shared photo"
                            className="max-h-48 w-auto rounded-xl border border-border object-cover"
                          />
                        ) : (
                          <div
                            className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-snug [overflow-wrap:anywhere] ${
                              isMine ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
                            }`}
                          >
                            {message.content.text}
                          </div>
                        )}
                        <div className={`mt-1 px-1 text-[10px] text-muted ${isMine ? "text-right" : ""}`}>
                          {isMine && message.status === "sending"
                            ? "Sending…"
                            : isMine && message.status === "failed"
                              ? "Not delivered"
                              : formatTime(message.ts)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              {peerTyping && <TypingDots />}
            </div>

            {blocked && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{CHAT_BLOCKED_MESSAGE}</p>}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
              className="flex shrink-0 items-center gap-1.5 border-t border-border p-3"
            >
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setBlocked(false)
                  if (event.target.value) onNotifyTyping()
                }}
                placeholder={disabled ? "Chat opens once you're matched" : "Message"}
                disabled={disabled}
                maxLength={500}
                aria-label="Message"
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-[16px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50 sm:text-[13px]"
              />
              <button
                type="submit"
                disabled={disabled || !draft.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40"
              >
                <SendIcon className="h-3.5 w-3.5" />
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
