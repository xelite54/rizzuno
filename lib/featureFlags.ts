/**
 * Friend requests and friendships are real and persisted as of 2026-08-25 —
 * see lib/db.ts's friend_requests/friendships tables (migration
 * 0004_friends), server/ws-server.ts's "friend-request"/"friend-respond"/
 * "unfriend"/"friend-block" handlers, and hooks/useMatchmaking.ts, which
 * drives the UI from the server's actual state instead of a local flag.
 * Sending a request now genuinely reaches the other account — live, if
 * they're online, and durably either way (it's still there next time they
 * connect).
 *
 * Username search is also real as of 2026-08-30 — see
 * lib/db.ts's searchUsersByUsername() and app/api/friends/search|request|
 * block, which replaced FriendsPanel.tsx's old hardcoded-empty `DIRECTORY`.
 *
 * Friend-to-friend chat/messaging (the "message" view inside
 * FriendsPanel.tsx) is still exactly as fake as before — out of scope of
 * the work above, not accidentally left behind. Don't infer from this flag
 * being `true` that it works too.
 */
export const FRIENDS_ENABLED = true
