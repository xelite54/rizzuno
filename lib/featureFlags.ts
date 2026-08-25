/**
 * The Friends system (friend requests, friend-to-friend messaging) still
 * has no real backend behind it — a "request" only ever sets a flag on the
 * sender's own screen, and nothing ever reaches the other person (see the
 * legal-fact-sheet audit that originally flagged this). Showing "Add
 * friend" / "Requested" implies a real request was delivered, which isn't
 * true — turned back on anyway, as an explicit, informed product decision
 * (2026-08-25), not because that limitation was fixed. If you're looking at
 * this because someone reported "Add friend" not actually reaching the
 * other person: that's this, working as currently (not) built, not a bug.
 * Building the real backend (persisted requests, delivery to the other
 * account, accept/decline that both sides see) is the actual fix; this flag
 * has nothing left to do once that exists.
 */
export const FRIENDS_ENABLED = true
