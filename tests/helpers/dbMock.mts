import { mock } from "node:test"

/**
 * One shared, mutable mock of `lib/db.ts` for the ws-server integration
 * suite — registered once, before server/ws-server.ts (and
 * server/matchmaker.ts) are ever imported, so every DB-backed call
 * throughout a real hello → find → matched round trip resolves without a
 * live Postgres. Individual tests reach in and override one function's
 * behavior (e.g. make `areFriends` throw, or `isBlockedEitherWay` return
 * true for one specific pair) via the returned `state` object, then restore
 * the default afterward — never a fresh module registration per test
 * (mock.module() is meant to be called once per resolved specifier for the
 * whole process).
 */
export const dbMockState = {
  incomingRequests: [] as { requestId: string; senderId: string; username: string; createdAt: number }[],
  genders: new Map<string, "male" | "female">(),
  plusEnabled: true,
  bannedUserIds: new Set<string>(),
  suspendedUntil: new Map<string, number>(),
  blockedPairs: new Set<string>(), // "a|b" — checked both directions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match the real areFriends(a, b) so a test can reassign this to something that actually inspects the pair
  areFriendsImpl: async (_a: string, _b: string): Promise<boolean> => false,
  addBlockShouldThrow: false,
  removeBlockResult: true,
  friendsSnapshotShouldThrow: false,
  /** Artificial delay before the block check resolves — lets a test create a genuine async window (e.g. to disconnect/pause a real socket mid-lookup) instead of simulating one synchronously. 0 by default (no delay). */
  blockCheckDelayMs: 0,
  /** Same idea, for the (separate, LATER) areFriends lookup inside tryMatch — lets a test create a real async window between a room being reserved and "matched" actually being sent, to exercise the final pre-commit eligibility check. */
  friendsCheckDelayMs: 0,
  /**
   * friendshipId -> [userA, userB] — a test seeds this directly (the same
   * convention `blockedPairs`/`genders` already use) rather than driving a
   * full sendFriendRequest/respondToFriendRequest flow, which this mock
   * doesn't model realistically. Backs getFriendshipOtherUser() and every
   * friend-chat function below — the one thing that makes "sender is
   * actually a party to this friendshipId" a real check in tests, not an
   * always-true stub.
   */
  friendships: new Map<string, [string, string]>(),
  /** In-memory friend_messages — mirrors the real table's columns closely enough to exercise dedup-by-(senderId, clientMessageId), ownership, and unread counting the same way lib/db.ts's real Postgres-backed versions do. */
  friendMessages: [] as {
    id: string
    friendshipId: string
    senderId: string
    recipientId: string
    text: string
    clientMessageId: string
    createdAt: number
    readAt: number | null
  }[],
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|")
}

let friendMessageCounter = 0

export function resetDbMockState() {
  dbMockState.incomingRequests = []
  dbMockState.genders.clear()
  dbMockState.plusEnabled = true
  dbMockState.bannedUserIds.clear()
  dbMockState.suspendedUntil.clear()
  dbMockState.blockedPairs.clear()
  dbMockState.areFriendsImpl = async () => false
  dbMockState.addBlockShouldThrow = false
  dbMockState.removeBlockResult = true
  dbMockState.friendsSnapshotShouldThrow = false
  dbMockState.blockCheckDelayMs = 0
  dbMockState.friendsCheckDelayMs = 0
  dbMockState.friendships.clear()
  dbMockState.friendMessages = []
  friendMessageCounter = 0
}

mock.module("../../lib/db.ts", {
  exports: {
    getPublicProfile: async () => ({ username: null, profilePhoto: null, bio: "", posts: [] }),
    hasRizzPlus: async () => dbMockState.plusEnabled,
    getAccountGender: async (id: string) => dbMockState.genders.get(id) ?? null,
    claimAccountGender: async (id: string, gender: "male" | "female") => {
      const previous = dbMockState.genders.get(id)
      if (previous && previous !== gender && !dbMockState.plusEnabled) return false
      dbMockState.genders.set(id, gender)
      return true
    },
    getUserStatus: async (userId: string) => ({
      id: userId,
      banned: dbMockState.bannedUserIds.has(userId),
      banReason: null,
      suspendedUntil: dbMockState.suspendedUntil.get(userId) ?? null,
      deleted: false,
    }),
    addBlock: async (blockerId: string, blockedId: string) => {
      if (dbMockState.addBlockShouldThrow) throw new Error("simulated addBlock failure")
      dbMockState.blockedPairs.add(pairKey(blockerId, blockedId))
    },
    removeBlock: async (blockerId: string, blockedId: string) => {
      const key = pairKey(blockerId, blockedId)
      const existed = dbMockState.blockedPairs.has(key)
      if (dbMockState.removeBlockResult && existed) dbMockState.blockedPairs.delete(key)
      return dbMockState.removeBlockResult && existed
    },
    isBlockedEitherWay: async (a: string, b: string) => {
      if (dbMockState.blockCheckDelayMs > 0) await new Promise((r) => setTimeout(r, dbMockState.blockCheckDelayMs))
      return dbMockState.blockedPairs.has(pairKey(a, b))
    },
    areFriends: async (a: string, b: string) => {
      if (dbMockState.friendsCheckDelayMs > 0) await new Promise((r) => setTimeout(r, dbMockState.friendsCheckDelayMs))
      return dbMockState.areFriendsImpl(a, b)
    },
    fileReport: async () => "report-id",
    sendFriendRequest: async () => ({ status: "sent", requestId: "req-id" }),
    respondToFriendRequest: async () => ({ status: "not_found" }),
    removeFriendship: async () => null,
    listFriends: async (userId: string) => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      // Derived from the same `friendships` registry the friend-chat mocks
      // below use — empty unless a test explicitly seeds it (see that
      // field's own doc comment), so this changes nothing for any
      // pre-existing test that never touches `friendships`.
      const result: { friendshipId: string; userId: string; username: string | null; profilePhoto: string | null; since: number }[] = []
      for (const [friendshipId, pair] of dbMockState.friendships) {
        if (pair[0] === userId) result.push({ friendshipId, userId: pair[1], username: pair[1], profilePhoto: null, since: 0 })
        else if (pair[1] === userId) result.push({ friendshipId, userId: pair[0], username: pair[0], profilePhoto: null, since: 0 })
      }
      return result
    },
    listPendingRequestsReceived: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return dbMockState.incomingRequests
    },
    listPendingRequestsSent: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
    listBlockedByUserWithUsernames: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
    getFriendshipOtherUser: async (userId: string, friendshipId: string) => {
      const pair = dbMockState.friendships.get(friendshipId)
      if (!pair) return null
      if (pair[0] === userId) return pair[1]
      if (pair[1] === userId) return pair[0]
      return null
    },
    sendFriendMessage: async (senderId: string, friendshipId: string, clientMessageId: string, text: string) => {
      const pair = dbMockState.friendships.get(friendshipId)
      const recipientId = pair ? (pair[0] === senderId ? pair[1] : pair[1] === senderId ? pair[0] : null) : null
      if (!recipientId) return { status: "not_friends" }
      if (dbMockState.blockedPairs.has(pairKey(senderId, recipientId))) return { status: "blocked" }
      const existing = dbMockState.friendMessages.find((m) => m.senderId === senderId && m.clientMessageId === clientMessageId)
      if (existing) {
        return {
          status: "sent",
          duplicate: true,
          recipientId,
          message: { id: existing.id, friendshipId, senderId, text: existing.text, createdAt: existing.createdAt },
        }
      }
      friendMessageCounter += 1
      const id = `fm-${friendMessageCounter}`
      const createdAt = Date.now()
      dbMockState.friendMessages.push({ id, friendshipId, senderId, recipientId, text, clientMessageId, createdAt, readAt: null })
      return { status: "sent", duplicate: false, recipientId, message: { id, friendshipId, senderId, text, createdAt } }
    },
    listFriendMessages: async (userId: string, friendshipId: string, limit = 50) => {
      const pair = dbMockState.friendships.get(friendshipId)
      if (!pair || (pair[0] !== userId && pair[1] !== userId)) return { status: "not_found" }
      const messages = dbMockState.friendMessages
        .filter((m) => m.friendshipId === friendshipId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-limit)
        .map((m) => ({ id: m.id, friendshipId, senderId: m.senderId, text: m.text, createdAt: m.createdAt }))
      return { status: "ok", messages }
    },
    markFriendMessagesRead: async (userId: string, friendshipId: string) => {
      const pair = dbMockState.friendships.get(friendshipId)
      if (!pair || (pair[0] !== userId && pair[1] !== userId)) return { status: "not_found" }
      const readAt = Date.now()
      let updated = 0
      for (const message of dbMockState.friendMessages) {
        if (message.friendshipId === friendshipId && message.recipientId === userId && message.readAt === null) {
          message.readAt = readAt
          updated++
        }
      }
      return { status: "ok", updated, readAt, otherUserId: pair[0] === userId ? pair[1] : pair[0] }
    },
    countUnreadFriendMessages: async (userId: string) => {
      const counts = new Map<string, number>()
      for (const message of dbMockState.friendMessages) {
        if (message.recipientId === userId && message.readAt === null) {
          counts.set(message.friendshipId, (counts.get(message.friendshipId) ?? 0) + 1)
        }
      }
      return counts
    },
    // lib/imageModeration/index.ts and abuse.ts's real DB-backed pieces —
    // safe no-cache/no-history defaults so anything that happens to route
    // an image through moderateImage() during a ws-server test (e.g. a
    // raw "chat" image message) doesn't crash for want of a live Postgres.
    // No existing ws-server test currently exercises that path; these
    // exist so a future one (or tests/wsChatModeration.test.mts, which
    // injects its own fake provider via setProviderForTesting) can, without
    // this file needing to grow moderation-specific test knobs itself.
    recordModerationEvent: async () => "fake-moderation-id",
    getCachedModerationDecision: async () => null,
    countRecentBlockedUploads: async () => 0,
    checkAndIncrementImageModerationRateLimit: async () => false,
  },
})
