"use client"
import { useRizzPlus } from "@/components/RizzPlusProvider"

type ProfileMenuProps = {
  /** Cosmetic fallback display name — see lib/guest.ts. */
  handle: string
  /** The user's own chosen username, if set — takes precedence over the random handle, matching My Profile. */
  username?: string
  /** The user's own profile photo, if set — shown instead of the initial letter, matching My Profile. */
  profilePhoto?: string | null
  onOpenProfile: () => void
}

/** No dropdown — tapping the avatar goes straight to the full My Profile screen. */
export function ProfileMenu({ handle, username, profilePhoto, onOpenProfile }: ProfileMenuProps) {
  const plus = useRizzPlus()
  const initial = username ? username.charAt(0).toUpperCase() : handle ? handle.charAt(0) : "?"

  return (
    <button
      type="button"
      onClick={onOpenProfile}
      aria-label={plus.active ? "My profile — Rizz+ subscriber" : "My profile"}
      className="relative pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-accent-2 text-[13px] font-semibold text-accent-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {profilePhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- local/data-URL profile photo, not a static asset
        <img src={profilePhoto} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        initial
      )}
      {plus.active && <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-[#e8cedf] text-[12px] text-[#261b28]" aria-hidden="true">+</span>}
    </button>
  )
}
