"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { UserProfileSheet, type ProfileTarget } from "./UserProfileSheet"
import { deriveRelationship } from "@/lib/profileRelationship"
import { subscriptionHref } from "@/lib/upgradeNavigation"
import type { DemoFriend, PendingRequest } from "@/hooks/useFriends"
import type { ReportCategory } from "@/lib/signaling/protocol"

/** What a surface passes to open someone's profile: who they are, plus any safe reference it already has. */
export type OpenUserProfileArgs = ProfileTarget & {
  /** Current-match / recent-match peer — lets "Add friend" use the realtime path. */
  displayId?: string | null
  /** A real account id the surface already legitimately knows (friend, request sender, invitation). */
  userId?: string | null
  /** Relationship facts the surface already has (e.g. a search row's flags). */
  hint?: { alreadyRequested?: boolean; alreadyFriends?: boolean }
  /** Called after the viewer blocks this person from the profile (e.g. drop them from search results). */
  onBlocked?: () => void
}

export type FriendRequestOutcome = "sent" | "already_friends" | "auto_accepted" | "failed"

type UserProfileContext = {
  openUserProfile: (args: OpenUserProfileArgs) => void
  closeUserProfile: () => void
  /** Username-addressed friend request (search), shared by search rows and the profile. */
  sendFriendRequestByUsername: (username: string) => Promise<FriendRequestOutcome>
  isRequestPending: (username: string) => boolean
  requestError: string | null
}

const Context = createContext<UserProfileContext | null>(null)

export function useUserProfile(): UserProfileContext {
  const value = useContext(Context)
  if (!value) throw new Error("useUserProfile must be used inside UserProfileProvider")
  return value
}

/**
 * The open-profile state. Held by whoever renders the provider (MatchStage),
 * so that component can open profiles too; everything beneath it uses
 * useUserProfile().
 */
export function useUserProfileTarget() {
  const [target, setTarget] = useState<OpenUserProfileArgs | null>(null)
  return { target, setTarget }
}

type ProviderProps = {
  children: React.ReactNode
  target: OpenUserProfileArgs | null
  setTarget: (target: OpenUserProfileArgs | null) => void
  friends: DemoFriend[]
  requests: PendingRequest[]
  /** Pending outgoing requests from the latest friends-snapshot. */
  sentRequests: { username: string | null }[]
  /** useMatchmaking's per-displayId friend action outcomes. */
  friendActionState: Map<string, string>
  /** The live call's partner, if any — blocking/reporting them uses the in-call path, which ends the call. */
  currentPeerDisplayId: string | null
  sendFriendRequestTo: (displayId: string) => void
  respondToFriendRequest: (requestId: string, accept: boolean) => void
  unfriend: (friendshipId: string) => void
  blockAccount: (userId: string) => void
  reportAccount: (userId: string, category: ReportCategory) => void
  blockCurrentPeer: () => void
  reportCurrentPeer: (category: ReportCategory) => void
}

const REQUEST_ERRORS: Record<string, string> = {
  not_authenticated: "Sign in again to send a friend request.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  not_found: "This profile is no longer available.",
  blocked: "A friend request can’t be sent to this account.",
  account_unavailable: "Your account can’t send requests right now.",
}

/**
 * Owns the ONE other-user profile: surfaces call openUserProfile(...) with
 * the identity they have, and this renders the shared UserProfileSheet with
 * a relationship derived from live friends/request state and the actions
 * that relationship allows, routed to the existing server paths.
 */
export function UserProfileProvider({
  children, target, setTarget, friends, requests, sentRequests, friendActionState, currentPeerDisplayId,
  sendFriendRequestTo, respondToFriendRequest, unfriend, blockAccount, reportAccount, blockCurrentPeer, reportCurrentPeer,
}: ProviderProps) {
  const [pendingUsernames, setPendingUsernames] = useState<string[]>([])
  const [requestError, setRequestError] = useState<string | null>(null)

  const openUserProfile = useCallback((args: OpenUserProfileArgs) => { setRequestError(null); setTarget(args) }, [setTarget])
  const closeUserProfile = useCallback(() => setTarget(null), [setTarget])

  const sendFriendRequestByUsername = useCallback(async (username: string): Promise<FriendRequestOutcome> => {
    const key = username.toLowerCase()
    if (pendingUsernames.includes(key)) return "sent"
    setRequestError(null)
    setPendingUsernames((previous) => [...previous, key]) // optimistic "Requested"
    try {
      const response = await fetch("/api/friends/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) })
      const data = await response.json().catch(() => ({}))
      if (response.status === 402) { window.location.assign(subscriptionHref("friends")); return "failed" }
      if (!response.ok || data.result === "blocked") throw new Error(REQUEST_ERRORS[data.error ?? data.result] ?? "Couldn’t save the friend request. Please try again.")
      return data.result === "already_friends" || data.result === "auto_accepted" ? data.result : "sent"
    } catch (error) {
      setPendingUsernames((previous) => previous.filter((u) => u !== key))
      setRequestError((error as Error).message || "Couldn’t send the friend request. Please try again.")
      return "failed"
    }
  }, [pendingUsernames])

  const sentUsernames = useMemo(() => new Set([
    ...pendingUsernames,
    ...sentRequests.flatMap((r) => r.username ? [r.username.toLowerCase()] : []),
  ]), [pendingUsernames, sentRequests])
  const isRequestPending = useCallback((username: string) => sentUsernames.has(username.toLowerCase()), [sentUsernames])

  const relationship = deriveRelationship({
    username: target?.username ?? null,
    displayId: target?.displayId,
    friends,
    incoming: requests,
    sentUsernames,
    displayIdAction: target?.displayId ? friendActionState.get(target.displayId) : null,
    hint: target?.hint,
  })

  const sameName = (a: string | null | undefined) => !!a && !!target?.username && a.toLowerCase() === target.username.toLowerCase()
  const friend = friends.find((f) => sameName(f.username))
  const request = requests.find((r) => sameName(r.username))
  const knownUserId = target?.userId ?? friend?.userId ?? request?.senderId ?? null
  const isCurrentPeer = !!target?.displayId && target.source === "match" && target.displayId === currentPeerDisplayId

  function addFriend() {
    if (!target) return
    if (target.displayId && (target.source === "match" || target.source === "history")) sendFriendRequestTo(target.displayId)
    else if (target.username) void sendFriendRequestByUsername(target.username)
  }

  function block() {
    if (!target) return
    if (isCurrentPeer) blockCurrentPeer()
    else if (knownUserId) blockAccount(knownUserId)
    else if (target.username) fetch("/api/friends/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: target.username }) }).catch(() => {})
    target.onBlocked?.()
    setTarget(null)
  }

  function report(category: ReportCategory) {
    if (!target) return
    if (isCurrentPeer) reportCurrentPeer(category)
    else if (knownUserId) reportAccount(knownUserId, category)
    else if (target.username) fetch("/api/friends/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: target.username, category }) }).catch(() => {})
  }

  const context = useMemo(() => ({ openUserProfile, closeUserProfile, sendFriendRequestByUsername, isRequestPending, requestError }), [openUserProfile, closeUserProfile, sendFriendRequestByUsername, isRequestPending, requestError])
  const canBlockOrReport = !!target && (isCurrentPeer || !!knownUserId || !!target.username)

  return (
    <Context.Provider value={context}>
      {children}
      <UserProfileSheet
        target={target}
        relationship={relationship}
        onClose={closeUserProfile}
        onAddFriend={addFriend}
        onAccept={() => { if (relationship.kind === "incoming") { respondToFriendRequest(relationship.requestId, true); setTarget(null) } }}
        onDecline={() => { if (relationship.kind === "incoming") { respondToFriendRequest(relationship.requestId, false); setTarget(null) } }}
        onRemoveFriend={() => { if (relationship.kind === "friend" && relationship.friendshipId) { unfriend(relationship.friendshipId); setTarget(null) } }}
        onBlock={canBlockOrReport ? block : undefined}
        onReport={canBlockOrReport ? report : undefined}
        actionError={requestError}
      />
    </Context.Provider>
  )
}
