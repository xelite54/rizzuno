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
]
