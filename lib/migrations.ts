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
]
