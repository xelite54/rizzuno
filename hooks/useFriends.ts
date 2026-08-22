"use client"

import { useCallback, useState } from "react"

export type DemoFriend = { id: string; displayName: string; username: string; online: boolean }
export type PendingRequest = { id: string; displayName: string; username: string }
export type BlockedUser = { id: string; displayName: string }

/**
 * Owns friends + friend requests at a level shared by both the Friends panel
 * and the in-call incoming-request toast, so accepting or declining from
 * either surface stays in sync with the other. Also owns who's blocked —
 * blocking removes them from friends/requests and keeps them out of search.
 *
 * Starts empty — there's no real backend yet for a friend request to
 * actually arrive from, so nothing is seeded or fabricated here. Accepting
 * a request (once one exists) is what actually populates `friends`.
 */
export function useFriends() {
  const [friends, setFriends] = useState<DemoFriend[]>([])
  const [requests, setRequests] = useState<PendingRequest[]>([])
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const blockedIds = blockedUsers.map((person) => person.id)
  const [toastRequestId, setToastRequestId] = useState<string | null>(null)

  const acceptRequest = useCallback(
    (id: string) => {
      const request = requests.find((r) => r.id === id)
      if (!request) return
      setRequests((prev) => prev.filter((r) => r.id !== id))
      setFriends((prev) => [
        ...prev,
        { id: request.id, displayName: request.displayName, username: request.username, online: true },
      ])
      setToastRequestId((current) => (current === id ? null : current))
    },
    [requests]
  )

  const declineRequest = useCallback((id: string) => {
    setRequests((prev) => prev.filter((r) => r.id !== id))
    setToastRequestId((current) => (current === id ? null : current))
  }, [])

  const removeFriend = useCallback((id: string) => {
    setFriends((prev) => prev.filter((f) => f.id !== id))
  }, [])

  // Block is stronger than unfriend — it also remembers who they were (not
  // just their id) so search and incoming requests can filter them out going
  // forward, and so the "Blocked users" list in your profile has a name to
  // actually show.
  const blockPerson = useCallback((id: string, displayName: string) => {
    setBlockedUsers((prev) => (prev.some((person) => person.id === id) ? prev : [...prev, { id, displayName }]))
    setFriends((prev) => prev.filter((f) => f.id !== id))
    setRequests((prev) => prev.filter((r) => r.id !== id))
    setToastRequestId((current) => (current === id ? null : current))
  }, [])

  const unblockPerson = useCallback((id: string) => {
    setBlockedUsers((prev) => prev.filter((person) => person.id !== id))
  }, [])

  const dismissToast = useCallback(() => setToastRequestId(null), [])

  return {
    friends,
    requests,
    blockedIds,
    blockedUsers,
    toastRequestId,
    acceptRequest,
    declineRequest,
    removeFriend,
    blockPerson,
    unblockPerson,
    dismissToast,
  }
}
