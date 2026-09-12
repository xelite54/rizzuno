/**
 * A minimum gap between sends on any one chat surface — friend chat
 * (FriendsPanel.tsx) and live match chat (MatchChatPanel.tsx) both use
 * this, so rapid-tapping Send reads the same way on either. Purely a
 * client-side pace limiter against one impatient burst of taps, the same
 * kind of guard as the typing-notification throttle in
 * hooks/useMatchmaking.ts's notifyTyping()/notifyFriendTyping() — not a
 * security boundary. server/ws-server.ts's own per-connection rate limiter
 * (60 messages/2s, hard-abuse cutoff at 300) is what actually bounds a
 * client that skips this entirely.
 */
export const CHAT_SEND_MIN_INTERVAL_MS = 1000

export const CHAT_SEND_TOO_FAST_MESSAGE = "You're sending too fast — wait a second."
