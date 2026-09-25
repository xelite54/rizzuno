"use client"

import { UserAvatar } from "@/components/UserAvatar"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { containsBlockedChatContent, CHAT_BLOCKED_MESSAGE } from "@/lib/textFilter"
import { CHAT_SEND_MIN_INTERVAL_MS, CHAT_SEND_TOO_FAST_MESSAGE } from "@/lib/chatRateLimit"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ChatIcon, CloseIcon, SendIcon } from "@/components/icons"
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

/** Viewport overlay so the mobile self-camera never clips the conversation. */
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
  // Holds whichever reason the draft is currently blocked for — content
  // filtering (CHAT_BLOCKED_MESSAGE) or sending too fast
  // (CHAT_SEND_TOO_FAST_MESSAGE) — null when there's nothing to show.
  const [sendError, setSendError] = useState<string | null>(null)
  // When this match's chat last actually sent a message — purely a
  // client-side pace limiter against rapid-tapping Send; see
  // lib/chatRateLimit.ts's own doc comment for why this isn't a security
  // boundary.
  const lastSentAtRef = useRef(0)
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
      setSendError(CHAT_BLOCKED_MESSAGE)
      return
    }
    const now = Date.now()
    if (now - lastSentAtRef.current < CHAT_SEND_MIN_INTERVAL_MS) {
      setSendError(CHAT_SEND_TOO_FAST_MESSAGE)
      return
    }
    lastSentAtRef.current = now
    setSendError(null)
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
            className="fixed bottom-16 right-3 z-50 flex h-[480px] max-h-[70dvh] w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface/95 text-foreground shadow-2xl shadow-black/40 backdrop-blur-xl"
          >
            <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/5 px-5">
              <UserAvatar name={peer?.username || peer?.handle || "?"} username={peer?.username ?? null} photo={peer?.profilePhoto} className="h-10 w-10 text-[12px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-foreground">{peer ? (peer.username ?? peer.handle) : "Chat"}</p>

              </div>
              <span role="status" aria-label={disabled ? "Disconnected" : "Connected"} className={`h-2 w-2 rounded-full ${disabled ? "bg-muted" : "bg-emerald-400"}`} />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div ref={listRef} role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-5 py-4">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-muted">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                    <ChatIcon className="h-5 w-5" />
                  </span>
                  <p className="text-[13px]">{disabled ? "Waiting for a match…" : "Say hi"}</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const previous = messages[index - 1]
                  const showDayLabel = Boolean(previous) && !isSameDay(new Date(previous.ts), new Date(message.ts))
                  const isMine = message.from === "me"
                  const next = messages[index + 1]
                  const endsGroup = !next || next.from !== message.from || next.ts - message.ts > 60_000 || !isSameDay(new Date(next.ts), new Date(message.ts))
                  const showMeta = endsGroup || (isMine && (message.status === "sending" || message.status === "failed"))
                  return (
                    <div key={message.id}>
                      {showDayLabel && (
                        <div className="my-2 flex justify-center">
                          <span className="px-2.5 py-1 text-[10px] text-muted">
                            {formatDayLabel(message.ts)}
                          </span>
                        </div>
                      )}
                      <div className={`max-w-[85%] w-fit ${isMine ? "ml-auto" : ""}`}>
                        {message.content.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local/data-URL chat images, not a static asset
                          <img
                            src={message.content.dataUrl}
                            alt="Shared photo"
                            className="max-h-48 w-auto rounded-xl border border-border object-cover"
                          />
                        ) : (
                          <div
                            className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed [overflow-wrap:anywhere] ${
                              isMine ? `bg-accent text-accent-foreground ${endsGroup ? "rounded-br-md" : ""}` : `bg-white/7 text-foreground ${endsGroup ? "rounded-bl-md" : ""}`
                            }`}
                          >
                            {message.content.text}
                          </div>
                        )}
                        {showMeta && <div className={`mb-3 mt-1 px-1 text-[10px] text-muted ${isMine ? "text-right" : ""}`}>
                          {isMine && message.status === "sending"
                            ? "Sending…"
                            : isMine && message.status === "failed"
                              ? "Not delivered"
                              : formatTime(message.ts)}
                        </div>}
                      </div>
                    </div>
                  )
                })
              )}
              {peerTyping && <TypingDots />}
            </div>

            {sendError && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{sendError}</p>}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
              className="mx-3 mb-3 flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 focus-within:ring-1 focus-within:ring-accent-2"
            >
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setSendError(null)
                  if (event.target.value) onNotifyTyping()
                }}
                placeholder={disabled ? "Waiting for a match…" : "Message…"}
                disabled={disabled}
                maxLength={500}
                aria-label="Message"
                className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2.5 text-[16px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50 sm:text-[14px]"
              />
              <button
                type="submit"
                disabled={disabled || !draft.trim()}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40"
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
