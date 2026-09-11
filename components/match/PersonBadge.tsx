"use client"

import { FriendButton } from "./FriendButton"
import type { FriendState } from "./FriendButton"
import type { PeerProfile } from "@/hooks/useMatchmaking"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"
import { countryLabel } from "@/lib/country"

type PersonBadgeProps = {
  peer: PeerProfile | null
  friendState: FriendState
  onAddFriend: () => void
  onViewProfile: () => void
}

export function PersonBadge({ peer, friendState, onAddFriend, onViewProfile }: PersonBadgeProps) {
  if (!peer) return null

  const identity = peer.username ?? peer.handle
  const country = countryLabel(peer.countryCode)

  return (
    <div className="pointer-events-auto absolute left-3 top-9 z-10 max-w-[calc(100%-8rem)] md:left-5 md:top-5 md:max-w-[260px]"
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1.5 rounded-full bg-black/55 p-1.5">
        <button type="button" onClick={onViewProfile} aria-label={`View ${identity}'s profile`}
          className="flex min-w-0 items-center gap-2 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm">
            {peer.profilePhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- peer profile image
              <img src={peer.profilePhoto} alt="" className="h-full w-full object-cover" />
            ) : identity.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-[13px] font-semibold text-foreground">{identity}</span>
          {country && <span title={country.name} aria-label={country.name} className="shrink-0 text-base">{country.flag}</span>}
        </button>
        {FRIENDS_ENABLED && <FriendButton state={friendState} onAdd={onAddFriend} />}
      </div>
    </div>
  )
}
