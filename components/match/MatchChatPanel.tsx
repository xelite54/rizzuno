"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { CloseIcon, SendIcon } from "@/components/icons"
import { isSameDay, formatDayLabel, formatTime } from "@/lib/chatFormat"
import { EASE_OUT, DURATION_QUICK, DURATION_BASE } from "@/lib/motion"
import type { ChatMessage, PeerProfile } from "@/hooks/useMatchmaking"

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl bg-surface-2 px-3.5 py-3">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-muted"
          animate={{ y: [0, -4, 0] }}
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
 * The match chat, expanded into a small floating panel anchored just above
 * the chat icon on your own video (this must be rendered inside that
 * panel's positioned wrapper for the anchor to land correctly) — not a
 * full-screen takeover, not a screen-edge side panel either. Closes on its
 * own X or by clicking outside it.
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
  const [draft, setDraft] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [open, messages, peerTyping])

  function submit() {
    if (disabled || !draft.trim()) return
    onSend(draft)
    setDraft("")
  }

  return (
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
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "tween", duration: DURATION_BASE, ease: EASE_OUT }}
            className="absolute bottom-16 right-3 z-50 flex h-[440px] max-h-[70dvh] w-[340px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-[15px] font-semibold text-foreground">
                {peer ? (peer.username ?? peer.handle) : "Chat"}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
              {messages.length === 0 ? (
                <p className="mt-8 text-center text-[13px] text-muted">
                  {disabled ? "Chat opens once you're matched" : "Say hi 👋"}
                </p>
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
                            className={`rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                              isMine ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground"
                            }`}
                          >
                            {message.content.text}
                          </div>
                        )}
                        <div className={`mt-1 px-1 text-[10px] text-muted ${isMine ? "text-right" : ""}`}>
                          {formatTime(message.ts)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              {peerTyping && <TypingDots />}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
              className="flex items-center gap-1.5 border-t border-border p-3"
            >
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  if (event.target.value) onNotifyTyping()
                }}
                placeholder={disabled ? "Chat opens once you're matched" : "Message"}
                disabled={disabled}
                maxLength={500}
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-50"
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
    </AnimatePresence>
  )
}
