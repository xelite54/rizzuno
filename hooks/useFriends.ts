/**
 * Client-facing Friends types, kept separate from the hook that actually
 * produces them (useMatchmaking.ts, which already owns the one WebSocket
 * connection everything else here rides on — see server/ws-server.ts and
 * lib/db.ts for the real, persisted backend: friend_requests/friendships
 * tables, resolved server-side from a displayId to a real account exactly
 * the way block/report already do for room membership).
 *
 * This file used to *be* that hook — a local-only `useState` implementation
 * where a "request" only ever set a flag on the sender's own screen and
 * never reached anyone (see FRIENDS_ENABLED's history in
 * lib/featureFlags.ts). It's now just the shared shapes MatchStage.tsx maps
 * real server data into, so FriendsPanel.tsx / IncomingFriendRequestToast.tsx
 * / RequestProfileSheet.tsx / MyProfileSheet.tsx — which only ever cared
 * about these field names, not where the data came from — needed close to
 * no changes.
 */

// `id` is always the request/friendship's own opaque id (used to
// accept/decline/unfriend) — `userId`/`senderId` is the real account id,
// carried alongside specifically so a block action (which needs the real
// account, not the request/friendship row) has something to target. See
// MatchStage.tsx for where these get populated from useMatchmaking()'s real
// friends-snapshot data, and FriendsPanel.tsx for where `userId`/`senderId`
// actually gets used (blocking a friend or search result).
export type DemoFriend = { id: string; userId: string; displayName: string; username: string; online: boolean }
export type PendingRequest = { id: string; senderId: string; displayName: string; username: string }
export type BlockedUser = { id: string; displayName: string }
