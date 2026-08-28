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
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|")
}

export function resetDbMockState() {
  dbMockState.bannedUserIds.clear()
  dbMockState.suspendedUntil.clear()
  dbMockState.blockedPairs.clear()
  dbMockState.areFriendsImpl = async () => false
  dbMockState.addBlockShouldThrow = false
  dbMockState.removeBlockResult = true
  dbMockState.friendsSnapshotShouldThrow = false
  dbMockState.blockCheckDelayMs = 0
}

mock.module("../../lib/db.ts", {
  exports: {
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
    areFriends: async (a: string, b: string) => dbMockState.areFriendsImpl(a, b),
    fileReport: async () => "report-id",
    sendFriendRequest: async () => ({ status: "sent", requestId: "req-id" }),
    respondToFriendRequest: async () => ({ status: "not_found" }),
    removeFriendship: async () => null,
    listFriends: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
    listPendingRequestsReceived: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
    listPendingRequestsSent: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
    listBlockedByUserWithUsernames: async () => {
      if (dbMockState.friendsSnapshotShouldThrow) throw new Error("simulated friends DB failure")
      return []
    },
  },
})
