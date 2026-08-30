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

/**
 * Formats a thrown value into the fields actually worth putting in a log
 * line — `code` in particular, since node-postgres puts the real diagnostic
 * signal there: a Postgres error code (e.g. `28P01` bad password, `3D000`
 * database doesn't exist, `42P07` relation already exists) for a query that
 * reached the server, or a plain Node network error code (`ECONNREFUSED`,
 * `ENOTFOUND`, `ETIMEDOUT`) for one that never did. `console.error`ing a raw
 * Error object alone tends to lose exactly this field in Vercel's log
 * viewer; pulling it out explicitly is what actually makes "the database is
 * unreachable" and "the database rejected this query" distinguishable at a
 * glance instead of both just reading "Error".
 */
export function describeDbError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; detail?: string }
    return { name: e.name, message: e.message, code: e.code, detail: e.detail }
  }
  return { err }
}

// Runs each pending migration at most once per database. Previously guarded
// by a Postgres advisory lock (pg_advisory_lock/unlock) — that's a
// session-scoped feature, and this pool's DATABASE_URL may well point at a
// connection pooler in transaction mode (Supabase's pooled connection
// string, commonly used specifically because Vercel's serverless functions
// each open their own short-lived connection and would otherwise exhaust a
// direct Postgres connection limit). Session-scoped advisory locks aren't
// safe under transaction-mode pooling — the lock and unlock aren't
// guaranteed to land on the same backend connection — so this needs no
// session state at all.
//
// It also went through a version in between this one and the advisory-lock
// original that claimed each migration with a single, separately-committed
// `INSERT ... ON CONFLICT DO NOTHING`, then ran that migration's SQL as a
// second, later statement. That was still a real race: the claim row
// commits (and becomes visible to every other connection) the instant that
// INSERT returns, which is *before* the migration's own SQL has even
// started — so a concurrent process checking the claim in that window sees
// the row, correctly concludes someone else is handling it, and incorrectly
// treats the migration as already fully applied while it's still running.
//
// This version claims and runs each migration inside one real transaction
// on one dedicated client — BEGIN, the claiming INSERT, the migration's own
// SQL, COMMIT. Postgres's normal MVCC behavior does the serializing for
// free: a second transaction's `INSERT ... ON CONFLICT` against the same id
// blocks until the first transaction actually resolves. If the first
// commits, the second correctly sees "no row inserted" *and* can now trust
// that the migration genuinely finished (commit only happens after the
// migration SQL succeeded). If the first rolls back (the migration SQL
// failed), the second's insert succeeds instead, and it becomes the new
// claimant — a failed migration is retried, never skipped. This holds under
// transaction-mode pooling too: PgBouncer guarantees one backend connection
// for the full duration of one BEGIN…COMMIT, which is exactly what a single
// `pool.connect()`ed client used for this whole sequence relies on.
let migratedPromise: Promise<void> | null = null

function ensureMigrated(): Promise<void> {
  if (!migratedPromise) {
    migratedPromise = (async () => {
      const db = requirePool()
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`)
      } catch (err) {
        console.error("db: failed to create schema_migrations table", describeDbError(err))
        throw err
      }

      for (const migration of MIGRATIONS) {
        const client = await db.connect()
        try {
          await client.query("BEGIN")
          const claim = await client.query<{ id: string }>(
            `INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
            [migration.id, Date.now()]
          )
          if ((claim.rowCount ?? 0) === 0) {
            // Blocked above until whichever transaction held this id
            // resolved, then found it already committed — genuinely,
            // fully applied. Nothing to roll back; this transaction never
            // did anything.
            await client.query("ROLLBACK")
            continue
          }
          await client.query(migration.sql)
          await client.query("COMMIT")
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {})
          console.error(`db: migration "${migration.id}" failed`, describeDbError(err))
          throw err
        } finally {
          client.release()
        }
      }
    })()
    // A failed attempt shouldn't be cached forever as "the" migration
    // result — the next call retries instead of replaying the same
    // rejected promise for the lifetime of the process (e.g. after a
    // transient connection blip during a cold start).
    migratedPromise.catch(() => {
      migratedPromise = null
    })
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

/**
 * Appends acceptance records — never overwrites or deletes a prior one, so
 * what a user agreed to on a given date is never rewritten after the fact.
 *
 * Transactional (one client, BEGIN/COMMIT/ROLLBACK) so a mid-loop failure
 * — the connection dropping after recording "age18" but before "terms",
 * say — can't leave an account with only some of the three required
 * documents recorded; either all of them land, or none do. And idempotent:
 * `ON CONFLICT (user_id, document, version) DO NOTHING` (the unique
 * constraint added in migration 0002) means calling this twice for the same
 * already-current version — a client retry after a timed-out response whose
 * request actually succeeded, for instance — can't create duplicate rows or
 * otherwise change the outcome. It's still a real append-only history
 * across different *versions*: accepting v1 today and v2 next month still
 * produces two rows, one per version.
 */
export async function recordAcceptance(userId: string) {
  await ensureUser(userId)
  const ts = now()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    for (const doc of REQUIRED_DOCUMENTS) {
      await client.query(
        `INSERT INTO legal_acceptance (id, user_id, document, version, accepted_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, document, version) DO NOTHING`,
        [randomUUID(), userId, doc.document, doc.version, ts]
      )
    }
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function getAcceptanceHistory(userId: string) {
  const { rows } = await q<{ document: string; version: string; accepted_at: string }>(
    `SELECT document, version, accepted_at FROM legal_acceptance WHERE user_id = $1 ORDER BY accepted_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ ...r, accepted_at: Number(r.accepted_at) }))
}

export type ClaimUsernameResult = { ok: true } | { ok: false; reason: "taken" }

/**
 * Claims a username for this account, permanently and uniquely — once
 * claimed, no other account can take it, including after this account
 * stops using it (there's no self-service deletion that would free it up;
 * see app/api/account/delete's removal). Callers pass an already-lowercased,
 * already-format-validated username (see USERNAME_PATTERN in
 * app/api/profile/username/route.ts) — this function only enforces
 * uniqueness, not format.
 *
 * The real safety net against a race — two people submitting the same
 * available username at the same moment — is the UNIQUE index added in
 * migration 0003, not any pre-check here: this just attempts the UPDATE and
 * reports "taken" if Postgres itself rejects it with a unique-violation
 * (error code 23505), which is correct under concurrency in a way a
 * check-then-write ever only approximates.
 */
export async function claimUsername(userId: string, username: string): Promise<ClaimUsernameResult> {
  await ensureUser(userId)
  try {
    await q(`UPDATE users SET username = $1 WHERE id = $2`, [username, userId])
    return { ok: true }
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return { ok: false, reason: "taken" }
    }
    throw err
  }
}

/** Both accounts, lower id first — a friendship or a block-driven friend-cleanup is symmetric, and storing/querying it one canonical way (rather than once per direction) is what lets a plain UNIQUE constraint do the deduplication. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/**
 * Records a block — transactional because a block is also always stronger
 * than a friendship: blocking someone severs any existing friendship and
 * cancels any pending friend request between the two accounts, in either
 * direction, regardless of which surface (in-call safety menu or the
 * Friends panel) the block was made from. All in one transaction so a block
 * is never left half-applied (the block itself recorded but a stale
 * friendship left standing, or vice versa).
 */
export async function addBlock(blockerId: string, blockedId: string) {
  await ensureUser(blockerId)
  await ensureUser(blockedId)
  const ts = now()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO blocks (id, blocker_id, blocked_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [randomUUID(), blockerId, blockedId, ts]
    )
    const [a, b] = pairKey(blockerId, blockedId)
    await client.query(`DELETE FROM friendships WHERE user_a_id = $1 AND user_b_id = $2`, [a, b])
    await client.query(
      `UPDATE friend_requests SET status = 'declined', resolved_at = $1
       WHERE status = 'pending' AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`,
      [ts, blockerId, blockedId]
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Reverses a block — the real unblock feature this app previously didn't
 * have (blocking was permanent, by design, until now). Deliberately
 * directional and narrow: only the row `blockerId` themselves created
 * against `blockedId` is removable, and only that exact row — this can
 * never be used to remove a block the OTHER side placed (there is no way to
 * un-block yourself from someone else's perspective; that decision only
 * ever belongs to whoever made it). Returns whether a row actually existed
 * to remove, so a caller can tell "unblocked" apart from "there was nothing
 * to unblock" without a second query.
 *
 * Friendship/pending-request state is untouched — addBlock() severs those
 * as a side effect of blocking, but unblocking doesn't restore them; that
 * severing was a real, intentional consequence of the block, not bookkeeping
 * to roll back.
 */
export async function removeBlock(blockerId: string, blockedId: string): Promise<boolean> {
  const { rows } = await q(
    `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING id`,
    [blockerId, blockedId]
  )
  return rows.length > 0
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

/** The current, non-PII-adjacent snapshot of who you've blocked — just the account id and whatever username (if any) that account has claimed, for My Profile's "Blocked users" list. */
export async function listBlockedByUserWithUsernames(userId: string): Promise<{ userId: string; username: string | null }[]> {
  const { rows } = await q<{ blocked_id: string; username: string | null }>(
    `SELECT b.blocked_id, u.username FROM blocks b LEFT JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ userId: r.blocked_id, username: r.username }))
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const [x, y] = pairKey(a, b)
  const { rows } = await q(`SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2 LIMIT 1`, [x, y])
  return rows.length > 0
}

export type SendFriendRequestResult =
  | { status: "sent"; requestId: string }
  | { status: "auto_accepted" }
  | { status: "already_friends" }
  | { status: "already_requested" }
  | { status: "blocked" }

/**
 * Sends a friend request — or, if the other side already sent one to you,
 * treats this as accepting theirs instead, so two people who both hit "Add"
 * end up mutual friends rather than two one-sided pending rows silently
 * pointing at each other forever.
 */
export async function sendFriendRequest(senderId: string, recipientId: string): Promise<SendFriendRequestResult> {
  if (senderId === recipientId) return { status: "blocked" }
  await ensureUser(senderId)
  await ensureUser(recipientId)
  if (await isBlockedEitherWay(senderId, recipientId)) return { status: "blocked" }

  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")

    const [a, b] = pairKey(senderId, recipientId)
    const existingFriendship = await client.query(
      `SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2`,
      [a, b]
    )
    if (existingFriendship.rows.length > 0) {
      await client.query("ROLLBACK")
      return { status: "already_friends" }
    }

    const existingOutgoing = await client.query(
      `SELECT 1 FROM friend_requests WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'`,
      [senderId, recipientId]
    )
    if (existingOutgoing.rows.length > 0) {
      await client.query("ROLLBACK")
      return { status: "already_requested" }
    }

    // Mutual: the other side already requested you — accept theirs instead
    // of creating a second, redundant pending row. FOR UPDATE so a
    // concurrent response to this same row can't race with this claim.
    const reverse = await client.query<{ id: string }>(
      `SELECT id FROM friend_requests WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending' FOR UPDATE`,
      [recipientId, senderId]
    )
    if (reverse.rows[0]) {
      const ts = now()
      await client.query(`UPDATE friend_requests SET status = 'accepted', resolved_at = $1 WHERE id = $2`, [
        ts,
        reverse.rows[0].id,
      ])
      await client.query(
        `INSERT INTO friendships (id, user_a_id, user_b_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
        [randomUUID(), a, b, ts]
      )
      await client.query("COMMIT")
      return { status: "auto_accepted" }
    }

    const id = randomUUID()
    await client.query(
      `INSERT INTO friend_requests (id, sender_id, recipient_id, status, created_at) VALUES ($1, $2, $3, 'pending', $4)`,
      [id, senderId, recipientId, now()]
    )
    await client.query("COMMIT")
    return { status: "sent", requestId: id }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export type RespondToFriendRequestResult =
  | { status: "accepted"; senderId: string }
  | { status: "declined"; senderId: string }
  | { status: "not_found" }

/** `recipientId` is who's responding — a request can only be answered by the account it was actually sent to, never the sender or anyone else, checked here rather than trusted from the client. */
export async function respondToFriendRequest(
  recipientId: string,
  requestId: string,
  accept: boolean
): Promise<RespondToFriendRequestResult> {
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{ sender_id: string }>(
      `SELECT sender_id FROM friend_requests WHERE id = $1 AND recipient_id = $2 AND status = 'pending' FOR UPDATE`,
      [requestId, recipientId]
    )
    const row = rows[0]
    if (!row) {
      await client.query("ROLLBACK")
      return { status: "not_found" }
    }
    const ts = now()
    await client.query(`UPDATE friend_requests SET status = $1, resolved_at = $2 WHERE id = $3`, [
      accept ? "accepted" : "declined",
      ts,
      requestId,
    ])
    if (accept) {
      const [a, b] = pairKey(row.sender_id, recipientId)
      await client.query(
        `INSERT INTO friendships (id, user_a_id, user_b_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
        [randomUUID(), a, b, ts]
      )
    }
    await client.query("COMMIT")
    return { status: accept ? "accepted" : "declined", senderId: row.sender_id }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Returns the other account's id if a friendship was actually removed, or null if `friendshipId` didn't exist or didn't belong to `userId` — checked by the query itself (the WHERE clause), not trusted from the client. */
export async function removeFriendship(userId: string, friendshipId: string): Promise<{ otherId: string } | null> {
  const { rows } = await q<{ user_a_id: string; user_b_id: string }>(
    `DELETE FROM friendships WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) RETURNING user_a_id, user_b_id`,
    [friendshipId, userId]
  )
  const row = rows[0]
  if (!row) return null
  return { otherId: row.user_a_id === userId ? row.user_b_id : row.user_a_id }
}

export type FriendSummary = { friendshipId: string; userId: string; username: string | null; since: number }

export async function listFriends(userId: string): Promise<FriendSummary[]> {
  const { rows } = await q<{ id: string; other_id: string; created_at: string; username: string | null }>(
    `SELECT f.id,
            CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END AS other_id,
            f.created_at,
            u.username
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     WHERE f.user_a_id = $1 OR f.user_b_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ friendshipId: r.id, userId: r.other_id, username: r.username, since: Number(r.created_at) }))
}

export type ReceivedFriendRequest = { requestId: string; senderId: string; username: string | null; createdAt: number }

export async function listPendingRequestsReceived(userId: string): Promise<ReceivedFriendRequest[]> {
  const { rows } = await q<{ id: string; sender_id: string; created_at: string; username: string | null }>(
    `SELECT fr.id, fr.sender_id, fr.created_at, u.username
     FROM friend_requests fr
     JOIN users u ON u.id = fr.sender_id
     WHERE fr.recipient_id = $1 AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ requestId: r.id, senderId: r.sender_id, username: r.username, createdAt: Number(r.created_at) }))
}

export type SentFriendRequest = { requestId: string; recipientId: string; createdAt: number }

export async function listPendingRequestsSent(userId: string): Promise<SentFriendRequest[]> {
  const { rows } = await q<{ id: string; recipient_id: string; created_at: string }>(
    `SELECT id, recipient_id, created_at FROM friend_requests WHERE sender_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [userId]
  )
  return rows.map((r) => ({ requestId: r.id, recipientId: r.recipient_id, createdAt: Number(r.created_at) }))
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

/** The only profile field the database actually holds (see migration 0003 and claimUsername()) — kept separate from getUserStatus() so that hot enforcement path's query/shape stays exactly what it's always been for its many other callers (ticket minting, WS "hello", legal/accept). */
export async function getUsername(userId: string): Promise<string | null> {
  const { rows } = await q<{ username: string | null }>(`SELECT username FROM users WHERE id = $1`, [userId])
  return rows[0]?.username ?? null
}

/** Reverse of getUsername() — resolves a username back to the real account id, server-side only. Used by the friend-request/block-by-username routes (see app/api/friends/) to act on a search result without ever handing the client that id, the same rule lib/signaling/protocol.ts's "friend-request"/"friend-block" already document for displayId-resolved actions. */
export async function getUserIdByUsername(username: string): Promise<string | null> {
  const { rows } = await q<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  return rows[0]?.id ?? null
}

/** Escapes a user-supplied fragment for safe use inside a `LIKE`/`ILIKE` pattern — Postgres's default LIKE escape character is already backslash, so prefixing the three special characters with one is all this needs (no separate ESCAPE clause required). Without this, someone searching for e.g. `50%` or `a_b` would have `%`/`_` act as wildcards instead of literal characters. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export type UserSearchResult = { username: string }

/**
 * Real account search by username — case-insensitive, partial-match (see
 * app/api/friends/search, which trims/lowercases the query before this).
 * Excludes the caller themselves, anyone banned or deleted, and anyone
 * blocked in either direction — but deliberately NOT existing friends: this
 * is a general "find anyone by username" search, not a friends-only filter.
 *
 * Returns only the username, never the account id — the same "a client
 * never learns an arbitrary real id" rule this app already enforces for
 * displayId-resolved friend actions (see lib/signaling/protocol.ts's
 * "friend-request"/"friend-block" doc comments). A search result is acted
 * on by username; see sendFriendRequest()/addBlock() callers in
 * app/api/friends/, which resolve it back to a real id server-side only.
 */
export async function searchUsersByUsername(
  query: string,
  excludeUserId: string,
  limit = 20
): Promise<UserSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const { rows } = await q<{ username: string }>(
    `SELECT u.username
       FROM users u
      WHERE u.username IS NOT NULL
        AND u.username ILIKE '%' || $1 || '%'
        AND u.id <> $2
        AND u.banned_at IS NULL
        AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $2 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $2)
        )
      ORDER BY u.username ASC
      LIMIT $3`,
    [escapeLikePattern(trimmed.toLowerCase()), excludeUserId, limit]
  )
  return rows.map((r) => ({ username: r.username }))
}

export async function exportUserData(userId: string) {
  const [status, username, acceptance, blocked, reportsFiled] = await Promise.all([
    getUserStatus(userId),
    getUsername(userId),
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
    username,
    legalAcceptanceHistory: acceptance,
    usersYouBlocked: blocked,
    reportsYouFiled: reportsFiled,
  }
}
