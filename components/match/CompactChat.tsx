"use client"

import { ChatIcon } from "@/components/icons"

type CompactChatProps = {
  disabled: boolean
  onOpenChat: () => void
  /** How many of the peer's messages have arrived since the chat was last open — see MatchStage.tsx's own bookkeeping for what counts. 0 shows no badge at all. */
  unreadCount?: number
}

/**
 * The one chat control: an icon that opens the chat popover (history,
 * photos, typing indicator, timestamps, sending — see MatchChatPanel.tsx).
 * Lives in the translucent overlay on your own video, alongside mic/camera.
 */
export function CompactChat({ disabled, onOpenChat, unreadCount = 0 }: CompactChatProps) {
  return (
    <button
      type="button"
      onClick={onOpenChat}
      disabled={disabled}
      aria-label={disabled ? "Chat opens once you're matched" : unreadCount > 0 ? `Open chat — ${unreadCount} new message${unreadCount === 1 ? "" : "s"}` : "Open chat"}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40"
    >
      <ChatIcon className="h-[17px] w-[17px]" />
      {unreadCount > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}
