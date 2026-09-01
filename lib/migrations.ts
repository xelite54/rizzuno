/**
 * Ordered, append-only list of schema migrations. Each one runs at most
 * once (tracked in `schema_migrations`, see lib/db.ts) — never edit a
 * migration that's already shipped; add a new one instead, the same rule
 * as the legal-acceptance version bumps in lib/legalVersions.ts.
 *
 * Timestamps are stored as BIGINT epoch milliseconds rather than
 * TIMESTAMPTZ — that's what `Date.now()` produces everywhere this data is
 * read/written in lib/db.ts, and matching it exactly kept the migration
 * from SQLite (where these were plain INTEGER epoch-ms columns) behavior-
 * neutral instead of introducing timezone-conversion semantics nothing
 * else in the codebase expects.
 */
export type Migration = { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at BIGINT NOT NULL,
        banned_at BIGINT,
        ban_reason TEXT,
        suspended_until BIGINT,
        suspend_reason TEXT,
        deleted_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS legal_acceptance (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        document TEXT NOT NULL,
        version TEXT NOT NULL,
        accepted_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_legal_acceptance_user ON legal_acceptance(user_id, document);

      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE(blocker_id, blocked_id)
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        reported_id TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT,
        match_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

      CREATE TABLE IF NOT EXISTS moderation_actions (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        actor_admin_id TEXT NOT NULL,
        report_id TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        suspend_until BIGINT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_target ON moderation_actions(target_user_id);
    `,
  },
  {
    // Makes lib/db.ts's recordAcceptance() idempotent: it now upserts with
    // `ON CONFLICT (user_id, document, version) DO NOTHING`, so a client
    // retrying POST /api/legal/accept after a dropped response (the request
    // actually succeeded server-side, but the client never saw that) can't
    // create duplicate rows or otherwise change the outcome.
    //
    // recordAcceptance() had no such guard before this migration, so a
    // database that's been live for a while may already have genuine
    // duplicate rows for the same (user_id, document, version) — the DELETE
    // below clears those first (keeping the earliest one recorded, by
    // accepted_at then id as a deterministic tie-break) so the UNIQUE
    // constraint that follows can actually be added. This only removes
    // *duplicate* rows; it never touches what was accepted or when the
    // surviving row says it happened.
    id: "0002_legal_acceptance_unique",
    sql: `
      DELETE FROM legal_acceptance a USING legal_acceptance b
        WHERE a.user_id = b.user_id
          AND a.document = b.document
          AND a.version = b.version
          AND (a.accepted_at, a.id) > (b.accepted_at, b.id);

      ALTER TABLE legal_acceptance
        ADD CONSTRAINT legal_acceptance_user_document_version_key
        UNIQUE (user_id, document, version);
    `,
  },
  {
    // Adds server-side, permanently-unique usernames. Previously the
    // username a person picks in ChooseUsername (and can later change from
    // My Profile → Edit profile) was never sent to or stored by Rizzuno's
    // server at all — client-side only, per lib/db.ts's own long-standing
    // "no email, name, or profile content lives server-side" design, and
    // per the Privacy Policy's Section 4 (now updated to reflect this
    // change — see the accompanying legal-version bump). This migration is
    // a deliberate, narrow exception to that design specifically for
    // uniqueness: the column holds nothing but the lowercase username
    // itself, tied to the same account id everything else here already
    // uses, so a real match is never shown two different people claiming
    // to be the same handle.
    //
    // Nullable — not every account has picked a username yet — and a plain
    // Postgres UNIQUE index already treats multiple NULLs as non-colliding,
    // so accounts mid-onboarding never conflict with each other.
    id: "0003_users_username",
    sql: `
      ALTER TABLE users ADD COLUMN username TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `,
  },
  {
    // The real backend behind the Friends feature — previously a request
    // only ever set a flag on the sender's own screen (see
    // FRIENDS_ENABLED's history in lib/featureFlags.ts). `friend_requests`
    // is the durable, account-to-account record of who asked whom;
    // `friendships` is the resulting mutual relationship once accepted (or
    // auto-formed if both sides happened to request each other).
    //
    // `friendships` always stores the lower account id as user_a_id and the
    // higher as user_b_id (enforced in application code, see lib/db.ts's
    // pairKey()) — a friendship is symmetric, and storing it this one
    // canonical way (rather than once per direction) is what lets a plain
    // UNIQUE constraint prevent a duplicate row for the same pair.
    id: "0004_friends",
    sql: `
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        resolved_at BIGINT,
        UNIQUE (sender_id, recipient_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient ON friend_requests(recipient_id, status);
      CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, status);

      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        user_a_id TEXT NOT NULL,
        user_b_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE (user_a_id, user_b_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b_id);
    `,
  },
  {
    // Profile photo, bio, and posts move from browser-only localStorage
    // (hooks/useMyProfile.ts, entirely client-side) to server-authoritative
    // storage — the same narrow-exception reasoning migration
    // 0003_users_username already established for username: another
    // account can never see a friend's photo/bio/posts if the only copy
    // ever lived in the VIEWING account's own browser (see the friend-
    // profile bug this fixes — a friend profile could only ever show
    // whatever was already sitting in the CURRENT browser, never the
    // actual friend's own content). `profile_photo`/`bio` are nullable —
    // an account with nothing set yet has NULL, not an empty string, so
    // "never set" and "explicitly cleared" stay distinguishable. `posts`
    // gets its own table (one profile can have many) rather than a JSON
    // column, so a single post can be deleted/queried without rewriting
    // the whole array — same reasoning `friend_requests`/`friendships`
    // already used over a single denormalized blob.
    id: "0005_profile_fields",
    sql: `
      ALTER TABLE users ADD COLUMN profile_photo TEXT;
      ALTER TABLE users ADD COLUMN bio TEXT;

      CREATE TABLE IF NOT EXISTS user_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data_url TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_posts_user ON user_posts(user_id, created_at DESC);
    `,
  },
  {
    // The one centralized image-moderation pipeline's audit log AND its
    // moderation cache source (see lib/imageModeration/) — every profile
    // photo/post/chat image upload writes exactly one row here, whatever
    // the outcome, before (allow) or instead of (review/block) ever being
    // persisted/sent anywhere else. `image_hash` + `policy_version` +
    // `provider_model_version` together are the cache key: a later upload
    // of the exact same normalized bytes, under the exact same policy and
    // provider version, reuses the matching row's decision instead of
    // re-paying the provider — but a policy or provider upgrade changes
    // the version strings, so old decisions are never silently reused
    // against different rules. `categories` is a JSON-encoded array of
    // {category, score} — plain TEXT, matching every other JSON-shaped
    // field already stored this way in this schema (no JSONB elsewhere to
    // be consistent with). Deliberately does NOT store the image itself —
    // a rejected image is never retained anywhere past the request that
    // produced it, moderated or not.
    id: "0006_moderation_events",
    sql: `
      CREATE TABLE IF NOT EXISTS moderation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        image_hash TEXT NOT NULL,
        decision TEXT NOT NULL,
        categories TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_reference TEXT,
        policy_version TEXT NOT NULL,
        provider_model_version TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_events_cache
        ON moderation_events(image_hash, policy_version, provider_model_version, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_moderation_events_user
        ON moderation_events(user_id, decision, created_at DESC);
    `,
  },
]
