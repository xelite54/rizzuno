/**
 * The Friends system (friend requests, friend-to-friend messaging) has no
 * real backend behind it — a "request" only ever sets a flag on the
 * sender's own screen, and nothing ever reaches the other person (see the
 * legal-fact-sheet audit that flagged this). Showing "Add friend" /
 * "Requested" implies a real request was delivered, which isn't true.
 * Flipping this back to `true` once friend requests/messages are actually
 * delivered account-to-account is the whole fix — every call site already
 * checks this flag rather than assuming the feature works.
 */
export const FRIENDS_ENABLED = false
