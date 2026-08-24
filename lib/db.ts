import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { REQUIRED_DOCUMENTS } from "./legalVersions"
import { MIGRATIONS } from "./migrations"

/**
 * Rizzuno's persistent store — hosted Postgres (e.g. Supabase), shared by
 * both the Vercel-deployed Next.js app and the Railway-deployed realtime
 * server (server.ts). Both connect to the same `DATABASE_URL`; neither
 * depends on the other's local filesystem, because on Vercel there isn't
 * a durable one to depend on.
 *
 * This file previously used Node's built-in `node:sqlite` — correct for a
 * single co-located process, but a local file is invisible to a second
 * service on a second host, and Vercel's filesystem isn't durable across
 * invocations to begin with. There is no local-filesystem fallback here on
 * purpose: production must not silently depend on process disk.
 *
 * Deliberately minimal schema: the only "account" data kept here is the
 * Google account's stable id (`sub`) and moderation/legal state tied to it —
 * no email, name, or profile content lives server-side (see useMyProfile.ts
 * for why that's still client-side). That keeps deletion/anonymization
 * trivial (there's barely any PII to remove in the first place).
 */

const connectionString = process.env.DATABASE_URL
const isLocalDb = Boolean(connectionString && /localhost|127\.0\.0\.1/.test(connectionString))

const pool = connectionString
  ? new Pool({
      connectionString,
      // Managed Postgres (Supabase included) terminates TLS with a
      // certificate chain `pg` doesn't validate by default in this setup;
      // `rejectUnauthorized: false` still gets an encrypted connection,
      // just without pinning the CA. Not needed for a plain local instance.
      ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
    })
  : null

function requirePool(): Pool {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not configured. Both the Next.js app and the realtime server need it set to the same Postgres instance — see .env.example."
    )
  }
  return pool
}

// Runs each pending migration at most once per database, guarded by a
// Postgres advisory lock so multiple processes starting at the same moment
// (several Vercel cold starts, or a Railway deploy racing a Vercel one)
// don't try to run the same migration concurrently. Cached per process —
// every exported function below awaits this before its first real query,
// so nothing here needs its own "have we initialized yet" bookkeeping.
const MIGRATION_LOCK_ID = 7264615 // arbitrary, fixed — just needs to be consistent across processes
let migratedPromise: Promise<void> | null = null

function ensureMigrated(): Promise<void> {
  if (!migratedPromise) {
    migratedPromise = (async () => {
      const client = await requirePool().connect()
      try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
        await client.query(
          `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`
        )
        const { rows } = await client.query<{ id: string }>("SELECT id FROM schema_migrations")
        const applied = new Set(rows.map((r) => r.id))
        for (const migration of MIGRATIONS) {
          if (applied.has(migration.id)) continue
          await client.query(migration.sql)
          await client.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)", [
            migration.id,
            Date.now(),
          ])
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {})
        client.release()
      }
    })()
  }
  return migratedPromise
}

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
) {
  await ensureMigrated()
  return requirePool().query<T>(text, params)
}

/** Closes the pool — called from server.ts's graceful-shutdown handler so a SIGTERM doesn't leave open Postgres connections behind. No-op if DATABASE_URL was never configured. */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end()
}

export type UserStatus = {
  id: string
  banned: boolean
  banReason: string | null
  suspendedUntil: number | null
  deleted: boolean
}

function now() {
  return Date.now()
}

async function ensureUser(userId: string) {
  await q(`INSERT INTO users (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [userId, now()])
}

/** Creates the account row on first sight and reports its current standing — the one check every entry point (ticket minting, WS "hello") must pass before a user can do anything. */
export async function getUserStatus(userId: string): Promise<UserStatus> {
  await ensureUser(userId)
  const { rows } = await q<{
    banned_at: string | null
    ban_reason: string | null
    suspended_until: string | null
    deleted_at: string | null
  }>(`SELECT banned_at, ban_reason, suspended_until, deleted_at FROM users WHERE id = $1`, [userId])

  const row = rows[0]
  if (!row) return { id: userId, banned: false, banReason: null, suspendedUntil: null, deleted: false }

  const suspendedUntilMs = row.suspended_until ? Number(row.suspended_until) : null
  const suspendedUntil = suspendedUntilMs && suspendedUntilMs > now() ? suspendedUntilMs : null
  return {
    id: userId,
    banned: row.banned_at !== null,
    banReason: row.ban_reason,
    suspendedUntil,
    deleted: row.deleted_at !== null,
  }
}

export async function banUser(userId: string, reason: string | null) {
  await ensureUser(userId)
  await q(`UPDATE users SET banned_at = $1, ban_reason = $2, suspended_until = NULL WHERE id = $3`, [
    now(),
    reason,
    userId,
  ])
}

export async function suspendUser(userId: string, untilMs: number, reason: string | null) {
  await ensureUser(userId)
  await q(`UPDATE users SET suspended_until = $1, suspend_reason = $2 WHERE id = $3`, [untilMs, reason, userId])
}

/** "No action" / clearing a prior suspension — moderation decided nothing further is warranted. */
export async function clearModeration(userId: string) {
  await ensureUser(userId)
  await q(
    `UPDATE users SET banned_at = NULL, ban_reason = NULL, suspended_until = NULL, suspend_reason = NULL WHERE id = $1`,
    [userId]
  )
}

export { REQUIRED_DOCUMENTS }

export async function hasAcceptedCurrent(userId: string): Promise<boolean> {
  for (const doc of REQUIRED_DOCUMENTS) {
    const { rows } = await q(
      `SELECT 1 FROM legal_acceptance WHERE user_id = $1 AND document = $2 AND version = $3 LIMIT 1`,
      [userId, doc.document, doc.version]
    )
    if (rows.length === 0) return false
  }
  return true
}

/** Appends acceptance records — never overwrites or deletes a prior one, so what a user agreed to on a given date is never rewritten after the fact. */
export async function recordAcceptance(userId: string) {
  await ensureUser(userId)
  const ts = now()
  for (const doc of REQUIRED_DOCUMENTS) {
    await q(`INSERT INTO legal_acceptance (id, user_id, document, version, accepted_at) VALUES ($1, $2, $3, $4, $5)`, [
      randomUUID(),
      userId,
      doc.document,
      doc.version,
      ts,
    ])
  }
}

export async function getAcceptanceHistory(userId: string) {
  const { rows } = await q<{ document: string; version: string; accepted_at: string }>(
    `SELECT document, version, accepted_at FROM legal_acceptance WHERE user_id = $1 ORDER BY accepted_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ ...r, accepted_at: Number(r.accepted_at) }))
}

export async function addBlock(blockerId: string, blockedId: string) {
  await ensureUser(blockerId)
  await ensureUser(blockedId)
  await q(
    `INSERT INTO blocks (id, blocker_id, blocked_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [randomUUID(), blockerId, blockedId, now()]
  )
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $3 AND blocked_id = $4) LIMIT 1`,
    [a, b, b, a]
  )
  return rows.length > 0
}

export async function listBlockedByUser(userId: string): Promise<string[]> {
  const { rows } = await q<{ blocked_id: string }>(`SELECT blocked_id FROM blocks WHERE blocker_id = $1`, [userId])
  return rows.map((r) => r.blocked_id)
}

export type ReportInput = {
  reporterId: string
  reportedId: string
  category: string
  details?: string
  matchId?: string | null
}

export async function fileReport(input: ReportInput): Promise<string> {
  await ensureUser(input.reporterId)
  await ensureUser(input.reportedId)
  const id = randomUUID()
  await q(
    `INSERT INTO reports (id, reporter_id, reported_id, category, details, match_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, input.reporterId, input.reportedId, input.category, input.details ?? null, input.matchId ?? null, now()]
  )
  return id
}

export type ReportRow = {
  id: string
  reporter_id: string
  reported_id: string
  category: string
  details: string | null
  match_id: string | null
  status: string
  created_at: number
}

/** Admin-only — reports are never exposed to regular clients (see the admin route's authorization check). */
export async function listReports(status?: string): Promise<ReportRow[]> {
  const { rows } = status
    ? await q(`SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC`, [status])
    : await q(`SELECT * FROM reports ORDER BY created_at DESC`)
  return (rows as Record<string, unknown>[]).map((r) => ({ ...r, created_at: Number(r.created_at) })) as ReportRow[]
}

export async function getReport(id: string): Promise<ReportRow | undefined> {
  const { rows } = await q(`SELECT * FROM reports WHERE id = $1`, [id])
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? ({ ...row, created_at: Number(row.created_at) } as ReportRow) : undefined
}

export type ModerationAction = "no_action" | "warning" | "suspend" | "ban"

/** The only place enforcement actually gets applied — always through here, always attributed to a real admin id, always logged. Runs as one transaction: a report shouldn't end up marked reviewed if the enforcement action it implies failed to apply, or vice versa. */
export async function resolveReport(
  reportId: string,
  actorAdminId: string,
  action: ModerationAction,
  reason: string | null,
  suspendUntilMs: number | null
) {
  await ensureMigrated()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")

    const { rows } = await client.query(`SELECT * FROM reports WHERE id = $1 FOR UPDATE`, [reportId])
    const report = rows[0] as
      | { id: string; reported_id: string; status: string }
      | undefined
    if (!report) throw new Error("report not found")

    if (action === "ban") {
      await client.query(`INSERT INTO users (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
        report.reported_id,
        now(),
      ])
      await client.query(`UPDATE users SET banned_at = $1, ban_reason = $2, suspended_until = NULL WHERE id = $3`, [
        now(),
        reason,
        report.reported_id,
      ])
    } else if (action === "suspend" && suspendUntilMs) {
      await client.query(`INSERT INTO users (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
        report.reported_id,
        now(),
      ])
      await client.query(`UPDATE users SET suspended_until = $1, suspend_reason = $2 WHERE id = $3`, [
        suspendUntilMs,
        reason,
        report.reported_id,
      ])
    }
    // "no_action" deliberately touches no user-status columns — it must
    // never accidentally clear an unrelated, still-active ban.

    await client.query(`UPDATE reports SET status = 'reviewed' WHERE id = $1`, [reportId])
    await client.query(
      `INSERT INTO moderation_actions (id, target_user_id, actor_admin_id, report_id, action, reason, suspend_until, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), report.reported_id, actorAdminId, reportId, action, reason, suspendUntilMs, now()]
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function exportUserData(userId: string) {
  const [status, acceptance, blocked, reportsFiled] = await Promise.all([
    getUserStatus(userId),
    getAcceptanceHistory(userId),
    listBlockedByUser(userId),
    q<{ category: string; status: string; created_at: string }>(
      `SELECT category, status, created_at FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC`,
      [userId]
    ).then((res) => res.rows.map((r) => ({ ...r, created_at: Number(r.created_at) }))),
  ])
  return {
    accountId: userId,
    accountStatus: status,
    legalAcceptanceHistory: acceptance,
    usersYouBlocked: blocked,
    reportsYouFiled: reportsFiled,
  }
}
