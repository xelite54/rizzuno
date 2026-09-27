"use client"

import panelStyles from "@/components/match/SocialPanel.module.css"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { CloseIcon } from "@/components/icons"
import { EASE_OUT, DURATION_BASE } from "@/lib/motion"
import { usePublicProfile } from "@/hooks/usePublicProfile"
import { resolveProfilePhoto } from "@/lib/publicProfile"
import type { ProfileRelationship } from "@/lib/profileRelationship"
import type { ReportCategory } from "@/lib/signaling/protocol"
import { ProfileAvatar } from "@/components/match/ProfileAvatar"
import { PostGallery } from "@/components/match/PostGallery"
import { FriendButton } from "@/components/match/FriendButton"
import { ProfileActionsMenu } from "@/components/match/ProfileActionsMenu"
import { ReportButton } from "@/components/match/ReportButton"
import { FRIENDS_ENABLED } from "@/lib/featureFlags"

/** Where a profile was opened from — informational (tests, analytics); never changes what the profile shows. */
export type ProfileSource = "search" | "match" | "friend" | "request" | "invitation" | "history"

/** The identity a surface hands to openUserProfile — just enough to show a placeholder while the server profile loads. */
export type ProfileTarget = {
  username: string | null
  /** Shown until the server profile loads (username, or a match's random handle). */
  displayName: string
  /** Snapshot photo, a placeholder only — the server's current photo wins once known. */
  photo?: string | null
  source: ProfileSource
}

type UserProfileSheetProps = {
  target: ProfileTarget | null
  relationship: ProfileRelationship
  onClose: () => void
  onAddFriend?: () => void
  onAccept?: () => void
  onDecline?: () => void
  onRemoveFriend?: () => void
  onBlock?: () => void
  onReport?: (category: ReportCategory) => void
  /** e.g. a failed friend request, shown under the actions. */
  actionError?: string | null
}

/**
 * THE other-user profile. Every surface (search, current match, friends,
 * requests, invitations, recent matches) opens this same component through
 * openUserProfile() — see UserProfileProvider. It fetches the person's
 * current server profile itself (photo, username, bio, posts); the caller
 * supplies only who, and the provider supplies the live relationship and
 * the actions that relationship allows.
 */
export function UserProfileSheet(props: UserProfileSheetProps) {
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after hydration
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {props.target && <SheetBody key={`${props.target.source}:${props.target.username ?? props.target.displayName}`} {...props} target={props.target} />}
    </AnimatePresence>,
    document.body,
  )
}

function SheetBody({ target, relationship, onClose, onAddFriend, onAccept, onDecline, onRemoveFriend, onBlock, onReport, actionError }: UserProfileSheetProps & { target: ProfileTarget }) {
  const { profile, error, loading, retry } = usePublicProfile(target.username)
  const [confirm, setConfirm] = useState<"unfriend" | "block" | null>(null)
  const name = profile?.username ?? target.username ?? target.displayName
  const unavailable = error === "Profile unavailable." || (!target.username && !loading)
  const busy = loading && !!target.username
  const isFriend = relationship.kind === "friend"
  const canRemove = isFriend && !!relationship.friendshipId && !!onRemoveFriend
  const hasMenu = !unavailable && (canRemove || !!onBlock || !!onReport)

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s profile`}
      data-user-profile-sheet=""
      data-profile-source={target.source}
      data-relationship={relationship.kind}
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
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* The body is the scroll container: min-h-0 lets it shrink below its
          content inside the fixed flex column, so the header stays put and
          posts stay reachable. */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 py-10 text-center">
        {busy ? (
          <>
            <span className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-surface-2" aria-hidden="true" />
            <span className="mt-4 h-5 w-32 animate-pulse rounded bg-surface-2" aria-hidden="true" />
          </>
        ) : (
          <>
            <span className="relative flex h-24 w-24 shrink-0">
              <ProfileAvatar key={name} photo={unavailable ? null : resolveProfilePhoto(profile, target.photo)} identity={name} username={unavailable ? undefined : target.username} />
              {/* Presence dot — only when a friend is actually online. */}
              {isFriend && relationship.online && (
                <span className="absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full border-2 border-surface bg-online" />
              )}
            </span>
            {/* The "•••" trigger sits absolutely off the name so the name
                stays centered under the avatar. */}
            <div className="relative mt-4">
              <p className="text-[18px] font-semibold text-foreground">{name}</p>
              {hasMenu && (
                <div className="absolute left-full top-1/2 ml-1 -translate-y-1/2">
                  <ProfileActionsMenu ariaLabel={`More options for ${name}`} align="center" compact onClose={() => setConfirm(null)}>
                    {(closeMenu) =>
                      confirm ? (
                        <div className="px-2 py-1.5">
                          <p className="mb-2 px-1 text-[12px] leading-snug text-muted">
                            {confirm === "unfriend" ? `Remove ${name} as a friend?` : `Block ${name}? They won't be able to contact you, and won't show up in search.`}
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirm(null)}
                              className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => { const action = confirm; setConfirm(null); closeMenu(); if (action === "block") onBlock?.(); else onRemoveFriend?.() }}
                              className="flex-1 rounded-lg bg-danger py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
                            >
                              {confirm === "unfriend" ? "Remove friend" : "Block"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          {canRemove && (
                            <button type="button" onClick={() => setConfirm("unfriend")} className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-surface-2">
                              Remove friend
                            </button>
                          )}
                          {onBlock && (
                            <button type="button" onClick={() => setConfirm("block")} className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2">
                              Block
                            </button>
                          )}
                          {onReport && (
                            <ReportButton
                              onReport={onReport}
                              onSubmitted={() => setTimeout(closeMenu, 1100)}
                              triggerClassName="w-full rounded-xl px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2"
                            />
                          )}
                        </div>
                      )
                    }
                  </ProfileActionsMenu>
                </div>
              )}
            </div>
            {profile?.bio && <p className="mt-1.5 max-w-xs whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{profile.bio}</p>}
            {unavailable && <p className="mt-1.5 text-[12px] text-muted">This profile isn&apos;t available.</p>}
            {error && !unavailable && (
              <p role="alert" className="mt-1.5 text-[12px] text-danger">
                Couldn&apos;t load this profile — <button type="button" onClick={retry} className="underline">try again</button>.
              </p>
            )}

            {!unavailable && FRIENDS_ENABLED && relationship.kind === "incoming" && (
              <>
                <p className="mt-2 text-[12px] text-muted">Wants to be friends</p>
                <div className="mt-6 flex w-full max-w-xs gap-2">
                  <button type="button" onClick={onDecline} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">
                    Decline
                  </button>
                  <button type="button" onClick={onAccept} className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground transition hover:brightness-110">
                    Accept
                  </button>
                </div>
              </>
            )}
            {!unavailable && FRIENDS_ENABLED && (relationship.kind === "stranger" || relationship.kind === "requested") && onAddFriend && (
              <div className="mt-6 w-full max-w-xs">
                <FriendButton state={relationship.kind === "requested" ? "requested" : "none"} onAdd={onAddFriend} variant="large" />
              </div>
            )}
            {actionError && <p role="alert" className="mt-3 text-[12px] text-danger">{actionError}</p>}
          </>
        )}

        <div className="mt-8 w-full max-w-lg border-t border-border pt-8">
          {busy ? (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="aspect-square animate-pulse rounded-xl bg-surface-2" aria-hidden="true" />
              ))}
            </div>
          ) : profile && profile.posts.length > 0 ? (
            <PostGallery posts={profile.posts} owner={name} />
          ) : (
            <div className="flex items-center justify-center py-10 text-[13px] text-muted">No posts yet</div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
