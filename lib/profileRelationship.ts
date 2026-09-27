/**
 * Where the viewer stands with the person whose profile is open — derived
 * from live, server-fed state (friends-snapshot, pending requests, this
 * session's friend actions) every render, never frozen at open time, so the
 * shared UserProfileSheet's controls update as the relationship changes.
 */
export type ProfileRelationship =
  | { kind: "stranger" }
  | { kind: "requested" }
  | { kind: "incoming"; requestId: string }
  | { kind: "friend"; friendshipId: string | null; online: boolean }

export type RelationshipInput = {
  username: string | null
  /** Current-match / history peers are addressed by displayId before a request exists. */
  displayId?: string | null
  friends: { id: string; username: string; online: boolean }[]
  incoming: { id: string; username: string }[]
  /** Usernames with a pending outgoing request (server snapshot + optimistic sends), lower-cased. */
  sentUsernames: ReadonlySet<string>
  /** useMatchmaking's per-displayId friend action outcome. */
  displayIdAction?: string | null
  /** What the opening surface already knew (e.g. a search row's flags). */
  hint?: { alreadyRequested?: boolean; alreadyFriends?: boolean }
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function deriveRelationship(input: RelationshipInput): ProfileRelationship {
  const { username } = input
  const friend = input.friends.find((f) => same(f.username, username))
  if (friend) return { kind: "friend", friendshipId: friend.id, online: friend.online }
  const incoming = input.incoming.find((r) => same(r.username, username))
  if (incoming) return { kind: "incoming", requestId: incoming.id }
  if (input.displayIdAction === "friends" || input.hint?.alreadyFriends) return { kind: "friend", friendshipId: null, online: false }
  if ((username && input.sentUsernames.has(username.toLowerCase())) || input.displayIdAction === "requested" || input.hint?.alreadyRequested) return { kind: "requested" }
  return { kind: "stranger" }
}
