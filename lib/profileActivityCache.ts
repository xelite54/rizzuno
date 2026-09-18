import type { BlockedUserSummary, PublicPeerIdentity } from "./signaling/protocol"

export const MAX_MATCH_HISTORY = 50
export const matchHistoryKey = (accountId: string) => `rizzuno:match-history:v1:${accountId}`
export const blockedUsersKey = (accountId: string) => `rizzuno:blocked-users:v1:${accountId}`

function parseList(raw: string | null): unknown[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function parseMatchHistory(raw: string | null): PublicPeerIdentity[] {
  return parseList(raw).flatMap((value): PublicPeerIdentity[] => {
    if (!value || typeof value !== "object") return []
    const peer = value as Record<string, unknown>
    if (typeof peer.displayId !== "string" || typeof peer.handle !== "string") return []
    // Copy only public profile fields; never restore arbitrary stored properties.
    return [{
      displayId: peer.displayId,
      handle: peer.handle,
      ...(typeof peer.username === "string" ? { username: peer.username } : {}),
      ...(peer.gender === "male" || peer.gender === "female" ? { gender: peer.gender } : {}),
      ...(typeof peer.profilePhoto === "string" || peer.profilePhoto === null ? { profilePhoto: peer.profilePhoto } : {}),
      ...(typeof peer.countryCode === "string" ? { countryCode: peer.countryCode } : {}),
    }]
  }).slice(0, MAX_MATCH_HISTORY)
}

export function rememberMatch(history: PublicPeerIdentity[], peer: PublicPeerIdentity): PublicPeerIdentity[] {
  return [peer, ...history.filter((entry) => entry.displayId !== peer.displayId)].slice(0, MAX_MATCH_HISTORY)
}

export function parseBlockedUsers(raw: string | null): BlockedUserSummary[] {
  return parseList(raw).flatMap((value): BlockedUserSummary[] => {
    if (!value || typeof value !== "object") return []
    const blocked = value as Record<string, unknown>
    return typeof blocked.userId === "string" && (typeof blocked.username === "string" || blocked.username === null)
      ? [{ userId: blocked.userId, username: blocked.username }]
      : []
  })
}
