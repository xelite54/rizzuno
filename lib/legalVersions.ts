/**
 * The current required version of each document a user must have accepted.
 * Bumping a version here means anyone who already accepted the old one is
 * no longer considered current — lib/db.ts's `hasAcceptedCurrent` re-checks
 * against whatever's listed here, and the acceptance gate reappears for
 * them automatically. Their original acceptance record is never rewritten
 * or deleted (see lib/db.ts) — this only changes what counts as "current"
 * going forward.
 *
 * No dependency on node:sqlite or anything server-only — safe to import
 * from client components too (e.g. to show "you're being asked again
 * because Terms changed" copy), unlike lib/db.ts itself.
 */
export const REQUIRED_DOCUMENTS: { document: "age18" | "terms" | "privacy"; version: string }[] = [
  // Bumped 2026-08-23 (age18 "2"): the affirmation itself changed — from a
  // flat "at least 18" to "at least 18, or the age of majority where you
  // live if that's older" (see AgeGate.tsx) — so accounts that affirmed
  // under the old wording are asked to affirm the new one.
  { document: "age18", version: "2" },
  // Bumped 2026-08-23: full rewrite from placeholder copy to production
  // Terms/Privacy text (see the legal-accuracy audit) — a material change,
  // so every account with a prior acceptance record is asked again.
  //
  // Bumped again same day (2026-08-23b): expanded both documents into the
  // fully sectioned production text (42 Terms sections, 18 Privacy
  // sections) and fixed the /terms + /privacy scroll-clipping bug — also
  // a material change, so accounts that already accepted "2026-08-23" are
  // asked again too.
  //
  // Bumped 2026-08-23c: eligibility sections (Terms §2/§12, Privacy §13)
  // updated to match the same "18, or local age of majority if higher"
  // standard now stated at sign-in and in the affirmation checkbox — also
  // material.
  //
  // Bumped 2026-08-24: the U.S.-launch legal-accuracy pass — restructured
  // Terms to 44 sections (added a narrow user-content license grant, a "no
  // business relationship" clause, and a survival clause; fixed "another
  // signed-in adult user" to describe an age *affirmation*, not
  // verification; fixed the image-content-filtering overclaim; added
  // WebRTC/IP-exposure disclosure) and restructured Privacy to 22 sections
  // (corrected the profile-data claim to distinguish browser-only fields
  // from the ones the realtime server transiently processes for
  // matchmaking/display; removed "not stored, anywhere, ever"; added Do Not
  // Track/GPC, data-sale, U.S. state privacy rights, and CalOPPA sections).
  // Both are material changes, so every account with a prior acceptance
  // record is asked again.
  //
  // Bumped 2026-08-24b: finalized the age-eligibility language specifically
  // — Terms §2 now uses "represent and warrant" contractual language and
  // explicitly states Google Sign-In authenticates the account but does not
  // verify age; Terms §12 adds that parental permission doesn't apply, that
  // knowingly facilitating an ineligible user's access is prohibited, and
  // that Rizzuno may suspend/terminate an account it reasonably believes is
  // ineligible; Privacy §15 explicitly distinguishes the user-supplied age
  // declaration from what Google Sign-In actually supplies. Still no
  // government-ID, biometric, facial-age-estimation, or other third-party
  // age-verification technology — self-attestation only. Material change,
  // so every account with a prior acceptance record is asked again.
  //
  // Bumped 2026-08-24c: set the real contactEmail in lib/legalConfig.ts
  // (operatorName/operatorAddress/governingLaw/disputeResolution remain
  // unset — not invented) and corrected three overbroad/inconsistent
  // claims: Privacy §14 no longer says the export includes "everything"
  // (it's the self-service subset only — reports where the account was
  // reported and moderation-action details aren't in it); Privacy §13 no
  // longer understates what's retained after deletion (legal-acceptance
  // history, blocks, reports, moderation actions, and ban/suspension
  // records all survive it, matching §12); Terms §32/§42 no longer let the
  // full operational content license "survive" deletion indefinitely — it
  // now ends with the underlying use, with a narrow carve-out only for
  // material that's part of a retained record. Terms §41 no longer calls
  // the Safety page's guidance independently contractual. Material change,
  // so every account with a prior acceptance record is asked again.
  //
  // Bumped 2026-08-24d: removed self-service account deletion as a product
  // feature entirely (the "Delete account" control in My Profile, and
  // POST /api/account/delete — see lib/db.ts, which no longer exports
  // deleteAccount()). Terms §27 and Privacy §13 no longer describe a
  // self-service deletion control that doesn't exist; both now point to
  // the published contact email for privacy/deletion requests instead.
  // Privacy §18's rights list no longer claims "Delete your account" as a
  // current control. Material change, so every account with a prior
  // acceptance record is asked again.
  //
  // Bumped 2026-08-25: usernames are now claimed and enforced as
  // permanently unique server-side (migration 0003_users_username;
  // lib/db.ts's claimUsername(); POST /api/profile/username), a deliberate,
  // narrow exception to the otherwise client-only profile design. Terms §9
  // and Privacy §3/§4/§9/§12/§13/§14/§18 updated to reflect it — username is
  // no longer described as browser-only, the database-contents list now
  // includes it, retention now covers it, and the data export now includes
  // it. Material change, so every account with a prior acceptance record is
  // asked again. None of these bumps touch or remove any prior acceptance
  // row (see lib/db.ts's recordAcceptance/hasAcceptedCurrent) — this list
  // only changes what counts as "current" going forward.
  // Bumped 2026-08-25b: the friends feature now has a real, persisted
  // backend (migration 0004_friends adds friend_requests/friendships
  // tables; lib/db.ts's sendFriendRequest/respondToFriendRequest/
  // removeFriendship/listFriends/etc.; server/ws-server.ts's
  // "friend-request"/"friend-respond"/"unfriend"/"friend-block" handlers).
  // Terms gained a new §24 "Friends & friend requests" (all sections from
  // 24 onward renumbered by one) describing sending/accepting/declining/
  // unfriending and that blocking severs any friendship/pending request;
  // it also states friend-to-friend chat and username search are still not
  // functional despite appearing in the UI. Privacy §3 now discloses the
  // friend_requests/friendships tables, §7 adds a "Friends" purpose-of-
  // processing bullet, §12 adds retention entries for friend requests
  // (indefinite) and friendships (until unfriended), and §18's rights list
  // adds "Send, accept, or decline a friend request" and "Unfriend" as real
  // controls. Material change, so every account with a prior acceptance
  // record is asked again. None of these bumps touch or remove any prior
  // acceptance row (see lib/db.ts's recordAcceptance/hasAcceptedCurrent) —
  // this list only changes what counts as "current" going forward.
  // Bumped 2026-08-31: profile photo, bio, and posts move server-side
  // (migration 0005_profile_fields; lib/db.ts's getPublicProfile/
  // updateOwnProfile/addPost/removePost/getFriendshipOtherUser; app/api/
  // profile/me, app/api/profile/posts, app/api/friends/profile/
  // [friendshipId]) — the same narrow, deliberate exception migration
  // 0003_users_username already made for username, now extended to these
  // three fields specifically so a friend's profile can actually show
  // their real photo/bio/posts, not just whatever happens to be sitting in
  // the VIEWING account's own browser. Gender is NOT part of this move —
  // it stays exactly what it always was: browser-local storage, sent live
  // over the realtime connection for matching, never persisted to
  // Postgres. Terms §9 and Privacy §3/§4/§9/§12/§13/§14/§18 updated to
  // describe photo/bio/posts as server-stored (browser storage is now a
  // cache, not the authoritative copy) and gender as the one remaining
  // browser-only field. Material change, so every account with a prior
  // acceptance record is asked again. None of these bumps touch or remove
  // any prior acceptance row (see lib/db.ts's recordAcceptance/
  // hasAcceptedCurrent) — this list only changes what counts as "current"
  // going forward.
  // Bumped 2026-09-01: removed the self-service "Download my data" export
  // feature entirely — My Profile → Settings → Privacy & data, its
  // handler, GET /api/account/data, and lib/db.ts's exportUserData()
  // (along with getAcceptanceHistory()/listBlockedByUser(), which existed
  // only to feed it) are gone. Privacy §14 no longer describes a
  // self-service export button; it now points to the same contact
  // process §13 already uses for privacy/deletion requests. §18's rights
  // list updated to match. Material change (a previously available
  // self-service control no longer exists), so every account with a prior
  // acceptance record is asked again.
  { document: "terms", version: "2026-08-31" },
  { document: "privacy", version: "2026-09-01" },
]
