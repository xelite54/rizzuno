import type { FriendSummary } from "./signaling/protocol"

export const friendsCacheKey = (accountId: string) => `rizzuno:friends:v1:${accountId}`

export function parseFriendsCache(raw: string | null): FriendSummary[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null")
    if (!Array.isArray(value)) return []
    return value.filter((friend): friend is FriendSummary =>
      !!friend && typeof friend === "object" &&
      typeof friend.id === "string" && typeof friend.userId === "string" &&
      (friend.username === null || typeof friend.username === "string") &&
      (friend.profilePhoto === null || typeof friend.profilePhoto === "string") &&
      typeof friend.since === "number"
    ).map((friend) => ({ ...friend, online: false }))
  } catch {
    return []
  }
}
