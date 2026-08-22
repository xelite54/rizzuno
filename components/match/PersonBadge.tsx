"use client"

import { FriendButton } from "./FriendButton"
import type { FriendState } from "./FriendButton"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"

type PersonBadgeProps = {
  peer: PeerProfile | null
  friendState: FriendState
  onAddFriend: () => void
}

export function PersonBadge({ peer, friendState, onAddFriend }: PersonBadgeProps) {
  if (!peer) return null

  // One identity, not two — their chosen username if they have one, their
  // random handle otherwise, never both stacked together. No "@" — keeps
  // the design plain. The full profile (one tap away) keeps it just as
  // minimal.
  const identity = peer.username ?? peer.handle

  return (
    <div className="pointer-events-auto absolute left-5 top-5 max-w-[220px]">
      {/* Faint by default, same as the ••• menu on this side and your own
          corner controls — their name is context, not the point of the
          screen, so it shouldn't compete with their actual face. */}
      <div className="flex items-center gap-1.5 rounded-full bg-black/35 py-1.5 pl-3 pr-1.5 opacity-55 transition-opacity duration-300 hover:opacity-100 focus-within:opacity-100">
        <span className="truncate text-[13px] font-semibold text-foreground">{identity}</span>
        {FRIENDS_ENABLED && <FriendButton state={friendState} onAdd={onAddFriend} />}
      </div>
    </div>
  )
}
