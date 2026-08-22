"use client"

import { ChatIcon } from "@/components/icons"

type CompactChatProps = {
  disabled: boolean
  onOpenChat: () => void
}

/**
 * The one chat control: an icon that opens the chat popover (history,
 * photos, typing indicator, timestamps, sending — see MatchChatPanel.tsx).
 * Lives in the translucent overlay on your own video, alongside mic/camera.
 */
export function CompactChat({ disabled, onOpenChat }: CompactChatProps) {
  return (
    <button
      type="button"
      onClick={onOpenChat}
      disabled={disabled}
      aria-label={disabled ? "Chat opens once you're matched" : "Open chat"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-40"
    >
      <ChatIcon className="h-[17px] w-[17px]" />
    </button>
  )
}
