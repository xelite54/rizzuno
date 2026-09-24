import { boundedReportChat, type ReportChatEntry } from "./reportEvidence"
import { deleteStoredImage, storedImageKey } from "./imageStorage"
import { log } from "./observability"
import { Pool } from "pg"
import { databaseConfig } from "./dbConfig"
import { isValidReportCategory } from "./signaling/protocol"
import { isWireId } from "./signaling/validation"
import { randomUUID } from "node:crypto"
import { REQUIRED_DOCUMENTS } from "./legalVersions"
import { MIGRATIONS } from "./migrations"
import { recentMatchReportWindowMs } from "./recentMatches"

/** Shared persistent account, profile, social, moderation, billing and legal store. */
const connectionString = process.env.DATABASE_URL
const pool = connectionString ? new Pool(databaseConfig(connectionString)) : null
pool?.on("error", () => log.error("database.connection_error"))

function requirePool(): Pool {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not configured. Both the Next.js app and the realtime server need it set to the same Postgres instance — see .env.example."
    )
  }
  return pool
}

export async function hasRizzPlus(userId: string): Promise<boolean> {
  const { rows } = await q<{ active: boolean }>(`SELECT EXISTS (SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status='active' AND paid_until>$2) AS active`, [userId, Date.now()])
  return rows[0]?.active ?? false
}

/**
 * TEMPORARY — Rizz+ is being given away free while real billing isn't
 * wired up (see the checkout route, which calls this instead of creating a
 * Stripe session). Writes straight into billing_subscriptions with a
 * synthetic, non-Stripe subscription id (never collides with a real Stripe
 * `sub_...` id) so hasRizzPlus() reads it exactly like a paid one. No row
 * is added to billing_customers, since there's no real Stripe customer
 * behind it — that's also how the portal route tells a free grant apart
 * from a real subscription and skips offering a billing portal for it.
 */
export async function grantFreeRizzPlus(userId: string) {
  const subscriptionId = `free:${userId}`
  const farFuture = Date.UTC(2099, 0, 1)
  await q(
    `INSERT INTO billing_subscriptions(subscription_id,user_id,status,paid_until,event_created) VALUES($1,$2,'active',$3,$4)
     ON CONFLICT(subscription_id) DO UPDATE SET status='active',paid_until=EXCLUDED.paid_until`,
    [subscriptionId, userId, farFuture, now()]
  )
}

export async function getBillingCustomer(userId: string): Promise<string | null> {
  const { rows } = await q<{ customer_id: string }>(`SELECT customer_id FROM billing_customers WHERE user_id=$1`, [userId])
  return rows[0]?.customer_id ?? null
}

export async function cancelFreeRizzPlus(userId: string) {
  await q(`UPDATE billing_subscriptions SET status='canceled',paid_until=$2 WHERE subscription_id=$1 AND user_id=$3`, [`free:${userId}`, now(), userId])
}

export async function saveBillingCustomer(userId: string, customerId: string) {
  await q(`INSERT INTO billing_customers(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`, [userId, customerId])
}

export async function saveBillingSubscription(customerId: string, subscriptionId: string, status: string, paidUntil: number, eventCreated: number) {
  const result = await q(`INSERT INTO billing_subscriptions(subscription_id,user_id,status,paid_until,event_created)
    SELECT $2,user_id,$3,$4,$5 FROM billing_customers WHERE customer_id=$1
    ON CONFLICT(subscription_id) DO UPDATE SET status=EXCLUDED.status,paid_until=EXCLUDED.paid_until,event_created=EXCLUDED.event_created
    WHERE billing_subscriptions.event_created<=EXCLUDED.event_created`, [customerId, subscriptionId, status, paidUntil, eventCreated])
  return result.rowCount
}

/** Serializes checkout creation across processes without session-scoped locks. */
export async function withBillingLock<T>(userId: string, action: () => Promise<T>): Promise<T> {
  await ensureMigrated()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`billing:${userId}`])
    const result = await action()
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally { client.release() }
}

export async function getAccountGender(userId: string): Promise<"male" | "female" | null> {
  const { rows } = await q<{ gender: "male" | "female" | null }>(`SELECT gender FROM users WHERE id=$1`, [userId])
  return rows[0]?.gender ?? null
}

export async function claimAccountGender(userId: string, gender: "male" | "female"): Promise<boolean> {
  await ensureUser(userId)
  const result = await q(`UPDATE users SET gender=$2 WHERE id=$1 AND (gender IS NULL OR gender=$2 OR EXISTS (
    SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status='active' AND paid_until>$3
  ))`, [userId, gender, Date.now()])
  return (result.rowCount ?? 0) > 0
}

/**
 * Formats a thrown value into the fields actually worth putting in a log
 * line — `code` in particular, since node-postgres puts the real diagnostic
 * signal there: a Postgres error code (e.g. `28P01` bad password, `3D000`
 * database doesn't exist, `42P07` relation already exists) for a query that
 * reached the server, or a plain Node network error code (`ECONNREFUSED`,
 * `ENOTFOUND`, `ETIMEDOUT`) for one that never did. `log.error`ing a raw
 * Error object alone tends to lose exactly this field in Vercel's log
 * viewer; pulling it out explicitly is what actually makes "the database is
 * unreachable" and "the database rejected this query" distinguishable at a
 * glance instead of both just reading "Error".
 */
export function describeDbError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; detail?: string }
    return { name: "DatabaseError", message: "Database operation failed", code: e.code }
  }
  return { message: "Database operation failed" }
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
        log.error("db: failed to create schema_migrations table", describeDbError(err))
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
          log.error(`db: migration "${migration.id}" failed`, describeDbError(err))
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
  const started = performance.now()
  try { return await requirePool().query<T>(text, params) }
  catch (error) { log.error("database.query_failed", describeDbError(error)); throw error }
  finally { log.info("database.query", { durationMs: performance.now()-started, count: pool?.totalCount ?? 0, queueSize: pool?.waitingCount ?? 0 }) }
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
  temporaryAction: "restrict" | "suspend" | null
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
    temporary_action: "restrict" | "suspend" | null
    deleted_at: string | null
  }>(`SELECT banned_at, ban_reason, suspended_until, deleted_at,
      (SELECT action FROM moderation_actions m WHERE m.target_user_id=users.id AND m.action IN ('restrict','suspend') AND m.suspend_until=users.suspended_until ORDER BY m.created_at DESC LIMIT 1) AS temporary_action
      FROM users WHERE id = $1`, [userId])

  const row = rows[0]
  if (!row) return { id: userId, banned: false, banReason: null, suspendedUntil: null, temporaryAction: null, deleted: false }

  const suspendedUntilMs = row.suspended_until ? Number(row.suspended_until) : null
  const suspendedUntil = suspendedUntilMs && suspendedUntilMs > now() ? suspendedUntilMs : null
  return {
    id: userId,
    banned: row.banned_at !== null,
    banReason: row.ban_reason,
    suspendedUntil,
    temporaryAction: suspendedUntil ? row.temporary_action : null,
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

export type ClaimUsernameResult = { ok: true } | { ok: false; reason: "taken" }

/**
 * Claims a currently unique username; renaming or approved erasure releases
 * the previous name. Callers validate format; the database enforces uniqueness.
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
  if (blockerId === blockedId || !await lookupExistingTarget(blockedId)) throw new Error("invalid_target")
  const ts = now()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT id FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", [[blockerId,blockedId]])

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
  | { status: "subscription_required" }
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
  if (!await lookupExistingTarget(recipientId)) return { status: "blocked" }
  if (await isBlockedEitherWay(senderId, recipientId)) return { status: "blocked" }

  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")

    const [a, b] = pairKey(senderId, recipientId)
    // Serialize both directions of this pair before checking requests.
    // Two simultaneous Add clicks must not create crossed pending rows.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [JSON.stringify([a, b])])
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

    const membership = await client.query(
      `SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status='active' AND paid_until>$2 LIMIT 1`,
      [senderId, now()]
    )
    if (membership.rows.length === 0) {
      await client.query("ROLLBACK")
      return { status: "subscription_required" }
    }
    const id = randomUUID()
    await client.query(
      `INSERT INTO friend_requests (id, sender_id, recipient_id, status, created_at) VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (sender_id, recipient_id) DO UPDATE
       SET id=EXCLUDED.id, status='pending', created_at=EXCLUDED.created_at, resolved_at=NULL`,
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

export type FriendSummary = {
  friendshipId: string
  userId: string
  username: string | null
  /** Live-joined from `users.profile_photo`, same as `username` below — always the friend's CURRENT photo at query time, never a value cached from whenever the friendship formed. */
  profilePhoto: string | null
  since: number
}

export async function listFriends(userId: string): Promise<FriendSummary[]> {
  const { rows } = await q<{ id: string; other_id: string; created_at: string; username: string | null; profile_photo: string | null }>(
    `SELECT f.id,
            CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END AS other_id,
            f.created_at,
            u.username,
            u.profile_photo
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     WHERE f.user_a_id = $1 OR f.user_b_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  )
  return rows.map((r) => ({
    friendshipId: r.id,
    userId: r.other_id,
    username: r.username,
    profilePhoto: r.profile_photo,
    since: Number(r.created_at),
  }))
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
  chatContext?: ReportChatEntry[]
}

export async function recordMatchStart(input: { matchId: string; userAId: string; userBId: string; source: "random" | "friend"; startedAt?: number }) {
  if (!isWireId(input.matchId) || !isWireId(input.userAId) || !isWireId(input.userBId) || input.userAId === input.userBId) throw new Error("invalid_match")
  const [userAId, userBId] = [input.userAId, input.userBId].sort()
  const startedAt = input.startedAt ?? now()
  if (!Number.isSafeInteger(startedAt) || startedAt > now() + 60_000) throw new Error("invalid_match")
  await q(`INSERT INTO match_sessions(id,user_a_id,user_b_id,source,started_at,report_eligible_until)
    VALUES($1,$2,$3,$4,$5,$6)`, [input.matchId,userAId,userBId,input.source,startedAt,startedAt + recentMatchReportWindowMs()])
}

export async function recordMatchEnd(matchId: string, endedAt = now()) {
  if (!isWireId(matchId) || !Number.isSafeInteger(endedAt)) throw new Error("invalid_match")
  await q(`UPDATE match_sessions SET ended_at=GREATEST(started_at,$2) WHERE id=$1 AND ended_at IS NULL`, [matchId,endedAt])
}

export type RecentMatchForReport = {
  matchId: string
  username: string | null
  startedAt: number
  endedAt: number | null
  reportEligibleUntil: number
  reported: boolean
}

/** Returns only the signed-in account's still-reportable sessions. Stable
 * counterpart ids remain server-side; current public username is enough to
 * identify the interaction in this private safety view. */
export async function listRecentMatchesForReporting(userId: string): Promise<RecentMatchForReport[]> {
  const { rows } = await q<{
    id: string; username: string | null; started_at: string; ended_at: string | null;
    report_eligible_until: string; reported: boolean
  }>(`SELECT m.id,u.username,m.started_at,m.ended_at,m.report_eligible_until,
      EXISTS(SELECT 1 FROM reports r WHERE r.match_id=m.id AND r.reporter_id=$1) AS reported
    FROM match_sessions m
    JOIN users u ON u.id=CASE WHEN m.user_a_id=$1 THEN m.user_b_id ELSE m.user_a_id END
    WHERE (m.user_a_id=$1 OR m.user_b_id=$1) AND m.report_eligible_until>$2
    ORDER BY m.started_at DESC LIMIT 20`, [userId,now()])
  return rows.map(row => ({ matchId: row.id, username: row.username, startedAt: Number(row.started_at),
    endedAt: row.ended_at === null ? null : Number(row.ended_at), reportEligibleUntil: Number(row.report_eligible_until), reported: row.reported }))
}

/** Authorizes the target solely from the server-created room ledger. */
export async function fileRecentMatchReport(input: { reporterId: string; matchId: string; category: string; details?: string }) {
  if (!isWireId(input.matchId)) throw new Error("invalid_match")
  const { rows } = await q<{ user_a_id: string; user_b_id: string }>(
    `SELECT user_a_id,user_b_id FROM match_sessions
     WHERE id=$1 AND report_eligible_until>$2 AND (user_a_id=$3 OR user_b_id=$3)`, [input.matchId,now(),input.reporterId])
  const match = rows[0]
  if (!match) throw new Error("match_not_reportable")
  const reportedId = match.user_a_id === input.reporterId ? match.user_b_id : match.user_a_id
  return fileReport({ reporterId: input.reporterId, reportedId, category: input.category, details: input.details, matchId: input.matchId })
}

export async function fileReport(input: ReportInput): Promise<string> {
  if (!isValidReportCategory(input.category) || input.reporterId === input.reportedId || !await lookupExistingTarget(input.reportedId)) throw new Error("invalid_target")
  if (input.details && input.details.length > 500) throw new Error("invalid_report")
  if (await checkAndIncrementApiRateLimit(`report:${input.reporterId}`, 20, 3_600_000)) throw new Error("rate_limited")
  await ensureMigrated()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`report:${input.reporterId}:${input.reportedId}`])
    // Different category, detail or room remains a new report, including urgent safety information.
    const existing = await client.query(`SELECT id FROM reports WHERE reporter_id=$1 AND reported_id=$2 AND category=$3 AND COALESCE(details,'')=$4 AND COALESCE(match_id,'')=$5 AND created_at>$6 LIMIT 1`,
      [input.reporterId,input.reportedId,input.category,input.details ?? "",input.matchId ?? "",now()-3_600_000])
    const id = existing.rows[0]?.id ?? randomUUID()
    if (!existing.rows.length) await client.query(
      `INSERT INTO reports(id,reporter_id,reported_id,category,details,match_id,status,created_at,priority) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)`,
      [id,input.reporterId,input.reportedId,input.category,input.details ?? null,input.matchId ?? null,now(),input.category === "underage_concern" ? "urgent" : "normal"])
    if (!existing.rows.length) {
      if (input.category === "underage_concern") await client.query("UPDATE reports SET safety_state='open' WHERE id=$1", [id])
      const capturedAt = now()
      const reports = await client.query("SELECT id,category,status,created_at FROM reports WHERE reported_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 20", [input.reportedId,id])
      const actions = await client.query("SELECT id,action,created_at FROM moderation_actions WHERE target_user_id=$1 ORDER BY created_at DESC LIMIT 20", [input.reportedId])
      const chat = boundedReportChat(input.chatContext ?? [], capturedAt).filter(entry => entry.senderId === input.reporterId || entry.senderId === input.reportedId)
      await client.query("INSERT INTO report_evidence(report_id,captured_at,chat_context,history) VALUES($1,$2,$3,$4)", [id,capturedAt,JSON.stringify(chat),JSON.stringify({ reports: reports.rows, actions: actions.rows })])
    }
    await client.query("COMMIT")
    if (!existing.rows.length && input.category === "underage_concern") log.warn("moderation.urgent_report", { count: 1 })
    return id
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err }
  finally { client.release() }
}

export type ReportRow = {
  id: string
  reporter_id: string
  reported_id: string
  category: string
  priority: string
  safety_state: "none" | "open" | "closed"
  details: string | null
  match_id: string | null
  status: string
  created_at: number
}

/** Admin-only — reports are never exposed to regular clients (see the admin route's authorization check). */
export async function listReports(status?: string): Promise<ReportRow[]> {
  const { rows } = status
    ? await q(`SELECT * FROM reports WHERE (status = $1 OR ($1='pending' AND safety_state='open')) ORDER BY (priority='urgent') DESC, created_at DESC LIMIT 500`, [status])
    : await q(`SELECT * FROM reports ORDER BY (priority='urgent') DESC, created_at DESC LIMIT 500`)
  return (rows as Record<string, unknown>[]).map((r) => ({ ...r, created_at: Number(r.created_at) })) as ReportRow[]
}

export async function getReport(id: string): Promise<ReportRow | undefined> {
  const { rows } = await q(`SELECT * FROM reports WHERE id = $1`, [id])
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? ({ ...row, created_at: Number(row.created_at) } as ReportRow) : undefined
}

export type ModerationAction = "no_action" | "warning" | "restrict" | "suspend" | "ban"

/** The only place enforcement actually gets applied — always through here, always attributed to a real admin id, always logged. Runs as one transaction: a report shouldn't end up marked reviewed if the enforcement action it implies failed to apply, or vice versa. */
export async function resolveReport(
  reportId: string,
  actorAdminId: string,
  action: ModerationAction,
  reason: string | null,
  suspendUntilMs: number | null
) {
  if (!isWireId(reportId) || !["no_action", "warning", "restrict", "suspend", "ban"].includes(action)) throw new Error("invalid_action")
  if (["restrict", "suspend"].includes(action) && (!Number.isSafeInteger(suspendUntilMs) || suspendUntilMs! <= now() || suspendUntilMs! > now() + 366 * 86_400_000)) throw new Error("invalid_suspension")
  if (["restrict", "suspend", "ban"].includes(action) && (!reason?.trim() || reason.length > 500)) throw new Error("reason_required")
  await ensureMigrated()
  const client = await requirePool().connect()
  try {
    await client.query("BEGIN")

    const { rows } = await client.query(`SELECT * FROM reports WHERE id = $1 FOR UPDATE`, [reportId])
    const report = rows[0] as
      | { id: string; reported_id: string; status: string }
      | undefined
    if (!report) throw new Error("report not found")
    if (report.reported_id === actorAdminId) throw new Error("conflicted_reviewer")
    if (report.status !== "pending") throw new Error("report_already_reviewed")

    const previous = await client.query('SELECT banned_at,ban_reason,suspended_until,suspend_reason FROM users WHERE id=$1 FOR UPDATE', [report.reported_id])
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
    } else if ((action === "restrict" || action === "suspend") && suspendUntilMs) {
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
      `INSERT INTO moderation_actions (id, target_user_id, actor_admin_id, report_id, action, reason, suspend_until, created_at, previous_state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), report.reported_id, actorAdminId, reportId, action, reason, suspendUntilMs, now(), JSON.stringify(previous.rows[0] ?? {})]
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export type UserAppeal = {
  id: string
  enforcementId: string
  action: ModerationAction
  category: string | null
  enforcementAt: number
  expiresAt: number | null
  reason: string
  evidenceReference: string | null
  submittedAt: number
  status: "submitted" | "under_review" | "upheld" | "overturned" | "dismissed"
  resolution: string | null
  resolvedAt: number | null
}

/** User-facing appeal history deliberately excludes moderator identity,
 * internal enforcement reasons, prior-state snapshots and report evidence. */
export async function listUserAppeals(userId: string): Promise<UserAppeal[]> {
  const { rows } = await q<Record<string, unknown>>(`SELECT a.id,a.enforcement_id,m.action,r.category,m.created_at AS enforcement_at,
      m.suspend_until,a.reason,a.evidence_reference,a.submitted_at,a.status,a.resolution,a.resolved_at
    FROM appeals a JOIN moderation_actions m ON m.id=a.enforcement_id
    LEFT JOIN reports r ON r.id=m.report_id WHERE a.user_id=$1 ORDER BY a.submitted_at DESC`, [userId])
  return rows.map(row => ({ id:String(row.id),enforcementId:String(row.enforcement_id),action:row.action as ModerationAction,
    category:row.category === null ? null : String(row.category),enforcementAt:Number(row.enforcement_at),
    expiresAt:row.suspend_until === null ? null : Number(row.suspend_until),reason:String(row.reason),
    evidenceReference:row.evidence_reference === null ? null : String(row.evidence_reference),submittedAt:Number(row.submitted_at),
    status:row.status as UserAppeal["status"],resolution:row.resolution === null ? null : String(row.resolution),
    resolvedAt:row.resolved_at === null ? null : Number(row.resolved_at) }))
}

export async function listAppealableEnforcements(userId: string) {
  const { rows } = await q<{ id:string; action:ModerationAction; category:string|null; created_at:string; suspend_until:string|null; has_open_appeal:boolean }>(
    `SELECT m.id,m.action,r.category,m.created_at,m.suspend_until,
      EXISTS(SELECT 1 FROM appeals a WHERE a.enforcement_id=m.id AND a.status IN ('submitted','under_review')) AS has_open_appeal
     FROM moderation_actions m LEFT JOIN reports r ON r.id=m.report_id
     WHERE m.target_user_id=$1 AND m.action IN ('restrict','suspend','ban')
     ORDER BY m.created_at DESC LIMIT 50`, [userId])
  return rows.map(row => ({ enforcementId:row.id,action:row.action,category:row.category,
    createdAt:Number(row.created_at),expiresAt:row.suspend_until === null ? null : Number(row.suspend_until),hasOpenAppeal:row.has_open_appeal }))
}

export async function submitAppeal(input: { userId:string; enforcementId:string; reason:string; evidenceReference?:string }) {
  const reason=input.reason.trim(); const evidence=input.evidenceReference?.trim() || null
  if (!isWireId(input.enforcementId) || !reason || reason.length>2000 || (evidence?.length ?? 0)>500) throw new Error("invalid_appeal")
  const id=randomUUID()
  const result=await q(`INSERT INTO appeals(id,user_id,enforcement_id,reason,evidence_reference,submitted_at)
    SELECT $1,$2,m.id,$3,$4,$5 FROM moderation_actions m
    WHERE m.id=$6 AND m.target_user_id=$2 AND m.action IN ('restrict','suspend','ban')
    RETURNING id`, [id,input.userId,reason,evidence,now(),input.enforcementId])
  if (!result.rowCount) throw new Error("enforcement_not_appealable")
  return id
}

export type AdminAppeal = UserAppeal & { userId:string; reviewingAdminId:string|null }
export async function listAppeals(status: "submitted" | "under_review" | "resolved" = "submitted"): Promise<AdminAppeal[]> {
  const condition=status==="resolved" ? "a.status IN ('upheld','overturned','dismissed')" : "a.status=$1"
  const params=status==="resolved" ? [] : [status]
  const { rows }=await q<Record<string,unknown>>(`SELECT a.*,m.action,m.created_at AS enforcement_at,m.suspend_until,r.category
    FROM appeals a JOIN moderation_actions m ON m.id=a.enforcement_id LEFT JOIN reports r ON r.id=m.report_id
    WHERE ${condition} ORDER BY a.submitted_at ASC LIMIT 500`,params)
  return rows.map(row => ({ id:String(row.id),userId:String(row.user_id),enforcementId:String(row.enforcement_id),
    action:row.action as ModerationAction,category:row.category===null?null:String(row.category),enforcementAt:Number(row.enforcement_at),
    expiresAt:row.suspend_until===null?null:Number(row.suspend_until),reason:String(row.reason),
    evidenceReference:row.evidence_reference===null?null:String(row.evidence_reference),submittedAt:Number(row.submitted_at),
    status:row.status as UserAppeal["status"],reviewingAdminId:row.reviewing_admin_id===null?null:String(row.reviewing_admin_id),
    resolution:row.resolution===null?null:String(row.resolution),resolvedAt:row.resolved_at===null?null:Number(row.resolved_at) }))
}

export async function getAppealForAdmin(id:string): Promise<AdminAppeal|null> {
  if (!isWireId(id)) return null
  const all=await q<Record<string,unknown>>(`SELECT a.*,m.action,m.created_at AS enforcement_at,m.suspend_until,r.category
    FROM appeals a JOIN moderation_actions m ON m.id=a.enforcement_id LEFT JOIN reports r ON r.id=m.report_id WHERE a.id=$1`,[id])
  const row=all.rows[0]; if(!row)return null
  return { id:String(row.id),userId:String(row.user_id),enforcementId:String(row.enforcement_id),action:row.action as ModerationAction,
    category:row.category===null?null:String(row.category),enforcementAt:Number(row.enforcement_at),expiresAt:row.suspend_until===null?null:Number(row.suspend_until),
    reason:String(row.reason),evidenceReference:row.evidence_reference===null?null:String(row.evidence_reference),submittedAt:Number(row.submitted_at),
    status:row.status as UserAppeal["status"],reviewingAdminId:row.reviewing_admin_id===null?null:String(row.reviewing_admin_id),
    resolution:row.resolution===null?null:String(row.resolution),resolvedAt:row.resolved_at===null?null:Number(row.resolved_at) }
}

export async function resolveAppeal(input:{appealId:string;actorAdminId:string;outcome:"upheld"|"overturned"|"dismissed";resolution:string}) {
  if(!isWireId(input.appealId)||!["upheld","overturned","dismissed"].includes(input.outcome)||!input.resolution.trim()||input.resolution.length>2000)throw new Error("invalid_appeal_resolution")
  await ensureMigrated(); const client=await requirePool().connect()
  try {
    await client.query("BEGIN")
    const result=await client.query(`SELECT a.*,m.target_user_id,m.action,m.suspend_until,m.created_at,m.previous_state
      FROM appeals a JOIN moderation_actions m ON m.id=a.enforcement_id WHERE a.id=$1 FOR UPDATE OF a`,[input.appealId])
    const appeal=result.rows[0]
    if(!appeal||!["submitted","under_review"].includes(appeal.status))throw new Error("appeal_not_open")
    if(appeal.user_id===input.actorAdminId)throw new Error("conflicted_reviewer")
    if(input.outcome==="overturned"){
      const later=await client.query(`SELECT 1 FROM moderation_actions WHERE target_user_id=$1 AND created_at>$2 AND action IN ('restrict','suspend','ban') LIMIT 1`,[appeal.user_id,appeal.created_at])
      if(later.rowCount)throw new Error("later_enforcement_requires_review")
      const current=await client.query(`SELECT banned_at,suspended_until FROM users WHERE id=$1 FOR UPDATE`,[appeal.user_id])
      const state=current.rows[0]; if(!state)throw new Error("account_not_found")
      if(appeal.action==="ban"&&state.banned_at===null)throw new Error("enforcement_state_changed")
      if(["restrict","suspend"].includes(appeal.action)&&Number(state.suspended_until)!==Number(appeal.suspend_until))throw new Error("enforcement_state_changed")
      const previous=appeal.previous_state ?? {}
      await client.query(`UPDATE users SET banned_at=$2,ban_reason=$3,suspended_until=$4,suspend_reason=$5 WHERE id=$1`,
        [appeal.user_id,previous.banned_at??null,previous.ban_reason??null,previous.suspended_until??null,previous.suspend_reason??null])
    }
    await client.query(`UPDATE appeals SET status=$2,reviewing_admin_id=$3,resolution=$4,resolved_at=$5 WHERE id=$1`,
      [input.appealId,input.outcome,input.actorAdminId,input.resolution.trim(),now()])
    await client.query("COMMIT")
  } catch(error){await client.query("ROLLBACK").catch(()=>{});throw error} finally{client.release()}
}

/** Username alone (see migration 0003 and claimUsername()) — kept separate from getUserStatus() so that hot enforcement path's query/shape stays exactly what it's always been for its many other callers (ticket minting, WS "hello", legal/accept). Profile photo/bio/posts also live server-side now (migration 0005) — see getPublicProfile() below for the combined shape. */
export async function getUsername(userId: string): Promise<string | null> {
  const { rows } = await q<{ username: string | null }>(`SELECT username FROM users WHERE id = $1`, [userId])
  return rows[0]?.username ?? null
}

/** Reverse of getUsername() — resolves a username back to the real account id, server-side only. Used by the friend-request/block-by-username routes (see app/api/friends/) to act on a search result without ever handing the client that id, the same rule lib/signaling/protocol.ts's "friend-request"/"friend-block" already document for displayId-resolved actions. */
export async function getUserIdByUsername(username: string): Promise<string | null> {
  const { rows } = await q<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  return rows[0]?.id ?? null
}

export type Post = { id: string; dataUrl: string }

/** Everything a viewer is allowed to see about an account's profile — username plus the fields migration 0005 moved server-side (profilePhoto/bio/posts). Used both by GET /api/profile/me (an account's own) and GET /api/friends/profile/[friendshipId] (a friend's, only after that route verifies the friendship server-side) — deliberately the ONLY four fields either endpoint ever returns; no id, no email, no moderation/legal data. */
export type PublicProfile = { username: string | null; profilePhoto: string | null; bio: string; posts: Post[] }

// Re-enforced here, not just trusted from the client — the same posture
// claimUsername()'s UNIQUE-index/regex re-check already takes for username.
const MAX_BIO_LENGTH = 200 // matches MyProfileSheet.tsx's own client-side cap
const MAX_POSTS_PER_USER = 20 // matches MyProfileSheet.tsx's own MAX_POSTS

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const [{ rows: userRows }, posts] = await Promise.all([
    q<{ username: string | null; profile_photo: string | null; bio: string | null }>(
      `SELECT username, profile_photo, bio FROM users WHERE id = $1`,
      [userId]
    ),
    listPosts(userId),
  ])
  const row = userRows[0]
  return {
    username: row?.username ?? null,
    profilePhoto: row?.profile_photo ?? null,
    bio: row?.bio ?? "",
    posts,
  }
}

/**
 * Updates the caller's own profilePhoto and/or bio — only the fields
 * actually present in `updates` are touched (checked via `!== undefined`,
 * not truthiness), so saving a new photo alone can never accidentally
 * blank out the bio, and vice versa. `profilePhoto: null` explicitly
 * clears it (removing a photo is a real, distinct action from "didn't
 * send one this time"); `bio` has no null case — an empty string already
 * means "no bio", matching what MyProfileSheet.tsx's editor already sends.
 */
/** Cleanup must never turn a committed mutation into an apparent DB failure.
 * Recheck ALL references (including tombstones) so an ambiguous COMMIT response
 * or a shared reference cannot cause deletion of an image still in use. */
export async function cleanupUnreferencedStoredImage(reference: unknown): Promise<void> {
  if (!storedImageKey(reference)) return
  // Persist retries before touching Storage; a failure must remain actionable.
  try {
    await q('INSERT INTO image_deletion_queue(reference,created_at) VALUES($1,$2) ON CONFLICT DO NOTHING', [reference,now()])
    await deleteQueuedImage(String(reference))
  }
  catch { log.error("image.storage_cleanup_pending") }

}

async function cleanupStoredImages(references: unknown[]) {
  for (const reference of new Set(references)) await cleanupUnreferencedStoredImage(reference)
}

export async function updateOwnProfile(userId: string, updates: { profilePhoto?: string | null; bio?: string }): Promise<void> {
  let previous: string | null = null
  try {
    await ensureUser(userId)
    const client = await requirePool().connect()
    try {
      await client.query("BEGIN")
      const account = await client.query<{ profile_photo: string | null; deleted_at: string | null }>("SELECT profile_photo,deleted_at FROM users WHERE id=$1 FOR UPDATE", [userId])
      if (!account.rows.length || account.rows[0].deleted_at !== null) throw new Error("account_unavailable")
      if (updates.profilePhoto !== undefined) {
        previous = account.rows[0].profile_photo
        await client.query("UPDATE users SET profile_photo=$1 WHERE id=$2", [updates.profilePhoto, userId])
      }
      if (updates.bio !== undefined) await client.query("UPDATE users SET bio=$1 WHERE id=$2", [updates.bio.slice(0, MAX_BIO_LENGTH), userId])
      await client.query("COMMIT")
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error }
    finally { client.release() }
  } catch (error) {
    await cleanupUnreferencedStoredImage(updates.profilePhoto)
    throw error
  }
  if (previous !== updates.profilePhoto) await cleanupUnreferencedStoredImage(previous)
}

export async function listPosts(userId: string): Promise<Post[]> {
  const { rows } = await q<{ id: string; data_url: string }>(
    `SELECT id, data_url FROM user_posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, MAX_POSTS_PER_USER]
  )
  return rows.map((r) => ({ id: r.id, dataUrl: r.data_url }))
}

/** Adds one post, then trims back down to MAX_POSTS_PER_USER (oldest first) — mirrors MyProfileSheet.tsx's own client-side `.slice(0, MAX_POSTS)`, re-enforced here rather than trusted, so the cap holds even against a client that skips it. */
export async function addPost(userId: string, dataUrl: string): Promise<Post> {
  const id = randomUUID()
  let removed: { data_url: string }[] = []
  try {
    await ensureUser(userId)
    const client = await requirePool().connect()
    try {
      await client.query("BEGIN")
      // Serialize uploads with other uploads and account erasure. Insert + trim
      // must commit together before any of the returned objects are deleted.
      const account = await client.query("SELECT deleted_at FROM users WHERE id=$1 FOR UPDATE", [userId])
      if (!account.rows.length || account.rows[0].deleted_at !== null) throw new Error("account_unavailable")
      await client.query("INSERT INTO user_posts (id,user_id,data_url,created_at) VALUES ($1,$2,$3,$4)", [id,userId,dataUrl,now()])
      const trimmed = await client.query<{ data_url: string }>(`DELETE FROM user_posts WHERE user_id=$1 AND id NOT IN (
        SELECT id FROM user_posts WHERE user_id=$1 ORDER BY created_at DESC, (id=$3) DESC, id DESC LIMIT $2
      ) RETURNING data_url`, [userId, MAX_POSTS_PER_USER, id])
      removed = trimmed.rows
      await client.query("COMMIT")
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error }
    finally { client.release() }
  } catch (error) {
    await cleanupUnreferencedStoredImage(dataUrl)
    throw error
  }
  await cleanupStoredImages(removed.map(row => row.data_url))
  return { id, dataUrl }
}

/** The autocommit DELETE must finish before object cleanup. Ownership is checked
 * in SQL, and only actually removed rows can supply cleanup references. */
export async function removePost(userId: string, postId: string): Promise<boolean> {
  const { rows } = await q<{ data_url: string }>("DELETE FROM user_posts WHERE id=$1 AND user_id=$2 RETURNING data_url", [postId,userId])
  await cleanupStoredImages(rows.map(row => row.data_url))
  return rows.length > 0
}

/**
 * Resolves a friendship id to "the OTHER account in it" — but only if
 * `userId` is actually a party to that friendship; returns null otherwise,
 * without distinguishing "this friendship doesn't exist" from "it exists
 * but isn't yours" (the same don't-even-confirm-existence posture blocks
 * already take). This is the ONE authoritative check GET
 * /api/friends/profile/[friendshipId] relies on before handing back
 * anyone's profile — the client only ever supplies a friendshipId it was
 * already told about (its own friends-snapshot), never a raw account id,
 * and this is what stands between that and an arbitrary-profile leak.
 */
export async function getFriendshipOtherUser(userId: string, friendshipId: string): Promise<string | null> {
  const { rows } = await q<{ user_a_id: string; user_b_id: string }>(
    `SELECT user_a_id, user_b_id FROM friendships WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`,
    [friendshipId, userId]
  )
  const row = rows[0]
  if (!row) return null
  return row.user_a_id === userId ? row.user_b_id : row.user_a_id
}

export type FriendChatMessageRow = {
  id: string
  friendshipId: string
  senderId: string
  text: string
  createdAt: number
  /** When the recipient read this message (see markFriendMessagesRead()), or null if still unread. A freshly sent message is always null — sendFriendMessage() never has a reason to set it. */
  readAt: number | null
  /** The message this one is replying to, or null if it isn't a reply. Only ever set to a real message id already in THIS SAME friendship — see sendFriendMessage()'s own validation — never trusted at face value from a client-supplied value. */
  replyToId: string | null
}

export type SendFriendMessageResult =
  | { status: "sent"; message: FriendChatMessageRow; recipientId: string; duplicate: boolean }
  | { status: "not_friends" }
  | { status: "blocked" }

/**
 * Persists a friend-chat message — the durable backend behind Friends' text
 * chat (see server/ws-server.ts's "friend-chat-send" handler, the only
 * caller). Every check here is server-authoritative: `senderId` only ever
 * comes from the verified realtime connection, never a client-supplied
 * field, and getFriendshipOtherUser() above is what actually proves the
 * sender is a real party to `friendshipId` (and derives the recipient from
 * it) — the same authoritative check app/api/friends/profile/[friendshipId]
 * already uses for the same reason. A friendship removed (unfriend) or
 * either side blocking the other both make getFriendshipOtherUser()/
 * isBlockedEitherWay() fail this before anything is ever written.
 *
 * `clientMessageId` + the UNIQUE(sender_id, client_message_id) constraint
 * (see migration 0009_friend_messages) together make a retried send
 * idempotent: if this exact (sender, clientMessageId) pair was already
 * persisted, the existing row is returned (`duplicate: true`) instead of
 * inserting a second one — a network retry or a duplicate WS send can never
 * create two messages for what the sender considers one send.
 *
 * `replyToId`, if given, is verified to actually be a message already in
 * THIS SAME `friendshipId` before it's ever stored — a client claiming to
 * reply to some other conversation's message id (or one that never existed)
 * just gets silently reduced to no reply at all, the same "don't trust it,
 * don't fail the send over it either" treatment a stale/foreign id
 * deserves. Never resolved into the replied-to message's own text here —
 * see migration 0011_friend_message_replies' own comment for why this only
 * stores the id: the client already has (or can fetch) that text itself.
 */
export async function sendFriendMessage(
  senderId: string,
  friendshipId: string,
  clientMessageId: string,
  text: string,
  replyToId?: string | null
): Promise<SendFriendMessageResult> {
  const recipientId = await getFriendshipOtherUser(senderId, friendshipId)
  if (!recipientId) return { status: "not_friends" }
  if (await isBlockedEitherWay(senderId, recipientId)) return { status: "blocked" }

  const existing = await q<{ id: string; text: string; created_at: string; read_at: string | null; reply_to_id: string | null }>(
    `SELECT id, text, created_at, read_at, reply_to_id FROM friend_messages WHERE sender_id = $1 AND client_message_id = $2 AND friendship_id = $3`,
    [senderId, clientMessageId, friendshipId]
  )
  if (existing.rows[0]) {
    const row = existing.rows[0]
    return {
      status: "sent",
      duplicate: true,
      recipientId,
      message: { id: row.id, friendshipId, senderId, text: row.text, createdAt: Number(row.created_at), readAt: row.read_at === null ? null : Number(row.read_at), replyToId: row.reply_to_id },
    }
  }

  let validReplyToId: string | null = null
  if (replyToId) {
    const target = await q<{ id: string }>(
      `SELECT id FROM friend_messages WHERE id = $1 AND friendship_id = $2`,
      [replyToId, friendshipId]
    )
    validReplyToId = target.rows[0]?.id ?? null
  }

  const id = randomUUID()
  const ts = now()
  try {
    await q(
      `INSERT INTO friend_messages (id, friendship_id, sender_id, recipient_id, text, client_message_id, created_at, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, friendshipId, senderId, recipientId, text, clientMessageId, ts, validReplyToId]
    )
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      // Lost a race with itself (a near-simultaneous retry landing between
      // the SELECT above and this INSERT) — re-read rather than fail the
      // send outright; the row genuinely exists either way.
      const raced = await q<{ id: string; text: string; created_at: string; read_at: string | null; reply_to_id: string | null }>(
        `SELECT id, text, created_at, read_at, reply_to_id FROM friend_messages WHERE sender_id = $1 AND client_message_id = $2 AND friendship_id = $3`,
        [senderId, clientMessageId, friendshipId]
      )
      const row = raced.rows[0]
      if (row) {
        return {
          status: "sent",
          duplicate: true,
          recipientId,
          message: { id: row.id, friendshipId, senderId, text: row.text, createdAt: Number(row.created_at), readAt: row.read_at === null ? null : Number(row.read_at), replyToId: row.reply_to_id },
        }
      }
    }
    throw err
  }
  return { status: "sent", duplicate: false, recipientId, message: { id, friendshipId, senderId, text, createdAt: ts, readAt: null, replyToId: validReplyToId } }
}

/**
 * The latest page of a friendship's real message history (see
 * app/api/friends/messages/[friendshipId], the only caller) — ordered
 * oldest-first (ready to render top-to-bottom) even though the query itself
 * fetches newest-first-then-reverses, so "latest N" and "oldest first on
 * screen" are both true at once. `userId` must be a real party to
 * `friendshipId` — verified the same way sendFriendMessage() is above,
 * never trusted from a client-supplied id.
 */
export async function listFriendMessages(
  userId: string,
  friendshipId: string,
  limit = 50
): Promise<{ status: "ok"; messages: FriendChatMessageRow[] } | { status: "not_found" }> {
  const otherId = await getFriendshipOtherUser(userId, friendshipId)
  if (!otherId) return { status: "not_found" }
  const { rows } = await q<{ id: string; sender_id: string; text: string; created_at: string; read_at: string | null; reply_to_id: string | null }>(
    `SELECT id, sender_id, text, created_at, read_at, reply_to_id FROM friend_messages WHERE friendship_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [friendshipId, limit]
  )
  const messages = rows
    .reverse()
    .map((r) => ({
      id: r.id,
      friendshipId,
      senderId: r.sender_id,
      text: r.text,
      createdAt: Number(r.created_at),
      readAt: r.read_at === null ? null : Number(r.read_at),
      replyToId: r.reply_to_id,
    }))
  return { status: "ok", messages }
}

export type MarkFriendMessagesReadResult =
  | { status: "ok"; updated: number; readAt: number; otherUserId: string }
  | { status: "not_found" }

/**
 * Marks every message `userId` has RECEIVED in `friendshipId` as read —
 * never messages they sent themselves (there is nothing to "read" about
 * your own outgoing message). Returns `{ status: "not_found" }` only if
 * `friendshipId` doesn't belong to `userId` at all; otherwise `"ok"` with
 * `updated` (how many rows actually flipped — 0 when there was nothing
 * unread) and `otherUserId`, so the caller (server/ws-server.ts's
 * "friend-chat-read" handler) knows who to push a "friend-chat-read-receipt"
 * to, and can skip that push entirely when `updated` is 0 — the sender's
 * messages are already however they were.
 */
export async function markFriendMessagesRead(userId: string, friendshipId: string): Promise<MarkFriendMessagesReadResult> {
  const otherId = await getFriendshipOtherUser(userId, friendshipId)
  if (!otherId) return { status: "not_found" }
  const readAt = now()
  const { rowCount } = await q(
    `UPDATE friend_messages SET read_at = $1 WHERE friendship_id = $2 AND recipient_id = $3 AND read_at IS NULL`,
    [readAt, friendshipId, userId]
  )
  return { status: "ok", updated: rowCount ?? 0, readAt, otherUserId: otherId }
}

/**
 * Unread-message counts for every friendship `userId` currently has an
 * unread message in — merged into each FriendSummary by
 * server/ws-server.ts's sendFriendsSnapshot(), never exposed as its own
 * endpoint (a bare count carries no message content, so it's safe to ride
 * along with everything else about a friend that snapshot already sends).
 */
export async function countUnreadFriendMessages(userId: string): Promise<Map<string, number>> {
  const { rows } = await q<{ friendship_id: string; count: string }>(
    `SELECT friendship_id, COUNT(*)::int AS count FROM friend_messages WHERE recipient_id = $1 AND read_at IS NULL GROUP BY friendship_id`,
    [userId]
  )
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.friendship_id, Number(row.count))
  return counts
}

/** Escapes a user-supplied fragment for safe use inside a `LIKE`/`ILIKE` pattern — Postgres's default LIKE escape character is already backslash, so prefixing the three special characters with one is all this needs (no separate ESCAPE clause required). Without this, someone searching for e.g. `50%` or `a_b` would have `%`/`_` act as wildcards instead of literal characters. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export type UserSearchResult = { username: string; profilePhoto: string | null; alreadyRequested: boolean; alreadyFriends: boolean }

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
 *
 * `alreadyRequested`/`alreadyFriends` are real database state, not a guess —
 * FriendsPanel.tsx's own "have I already added this search result" flag
 * used to be session-local React state only, which meant a page refresh
 * (or reopening the panel) forgot it even though the underlying request had
 * genuinely persisted. Checking it here means the UI reflects what's
 * actually true again after either.
 */
export async function searchUsersByUsername(
  query: string,
  excludeUserId: string,
  limit = 20
): Promise<UserSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const { rows } = await q<{ username: string; profile_photo: string | null; already_requested: boolean; already_friends: boolean }>(
    `SELECT u.username, u.profile_photo,
            EXISTS (
              SELECT 1 FROM friend_requests fr
               WHERE fr.sender_id = $2 AND fr.recipient_id = u.id AND fr.status = 'pending'
            ) AS already_requested,
            EXISTS (
              SELECT 1 FROM friendships f
               WHERE f.user_a_id = LEAST($2, u.id) AND f.user_b_id = GREATEST($2, u.id)
            ) AS already_friends
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
  return rows.map((r) => ({ username: r.username, profilePhoto: r.profile_photo, alreadyRequested: r.already_requested, alreadyFriends: r.already_friends }))
}

// ---------------------------------------------------------------------------
// Image moderation (see lib/imageModeration/) — the audit log / cache
// backing store for the ONE centralized moderation pipeline every profile
// photo/post/chat image upload goes through. This file only persists and
// queries these rows; it makes no moderation decisions itself.

export type ModerationSurface = "profile_photo" | "post" | "chat"
export type ModerationDecision = "allow" | "review" | "block"
export type ModerationCategoryScore = { category: string; score: number }

export type ModerationEventRecord = {
  userId: string
  surface: ModerationSurface
  imageHash: string
  decision: ModerationDecision
  categories: ModerationCategoryScore[]
  provider: string
  providerReference: string | null
  policyVersion: string
  providerModelVersion: string
}

/** Writes exactly one row per moderation attempt — called for every decision (allow/review/block), never only on rejection, so the cache below and the abuse-history counts have a complete picture. */
export async function recordModerationEvent(event: ModerationEventRecord): Promise<string> {
  const id = randomUUID()
  await q(
    `INSERT INTO moderation_events
       (id, user_id, surface, image_hash, decision, categories, provider, provider_reference, policy_version, provider_model_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      event.userId,
      event.surface,
      event.imageHash,
      event.decision,
      JSON.stringify(event.categories),
      event.provider,
      event.providerReference,
      event.policyVersion,
      event.providerModelVersion,
      now(),
    ]
  )
  return id
}

/**
 * The moderation cache lookup — the exact same normalized image, already
 * decided under the exact same policy version and provider model version,
 * reuses that decision instead of a fresh provider call. Any prior decision
 * (allow, review, or block) counts: re-paying the provider for an image
 * it has already scored, under rules that haven't changed, would be pure
 * waste either way. Most recent match wins if more than one exists.
 */
export async function getCachedModerationDecision(
  imageHash: string,
  policyVersion: string,
  providerModelVersion: string
): Promise<ModerationEventRecord & { moderationId: string } | null> {
  const { rows } = await q<{
    id: string
    user_id: string
    surface: ModerationSurface
    image_hash: string
    decision: ModerationDecision
    categories: string
    provider: string
    provider_reference: string | null
  }>(
    `SELECT id, user_id, surface, image_hash, decision, categories, provider, provider_reference
       FROM moderation_events
      WHERE image_hash = $1 AND policy_version = $2 AND provider_model_version = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [imageHash, policyVersion, providerModelVersion]
  )
  const row = rows[0]
  if (!row) return null
  let categories: ModerationCategoryScore[] = []
  try {
    categories = JSON.parse(row.categories)
  } catch {
    categories = []
  }
  return {
    moderationId: row.id,
    userId: row.user_id,
    surface: row.surface,
    imageHash: row.image_hash,
    decision: row.decision,
    categories,
    provider: row.provider,
    providerReference: row.provider_reference,
    policyVersion,
    providerModelVersion,
  }
}

/**
 * How many of this account's uploads (any surface) were BLOCKED within the
 * given window — the raw signal lib/imageModeration/abuse.ts's escalation
 * ladder is built on (see its own doc comment): a first blocked upload is
 * just a rejection, but a pattern of them within a short window earns a
 * temporary upload restriction rather than another silent one-off reject.
 * `categoryFilter`, when given, narrows to blocks that included at least
 * one of these categories — used for severe categories' own, stricter
 * (lower-threshold) escalation count, kept separate from the general one.
 */
export async function countRecentBlockedUploads(
  userId: string,
  sinceMs: number,
  categoryFilter?: string[]
): Promise<number> {
  if (categoryFilter && categoryFilter.length > 0) {
    const { rows } = await q<{ categories: string }>(
      `SELECT categories FROM moderation_events WHERE user_id = $1 AND decision = 'block' AND created_at > $2`,
      [userId, sinceMs]
    )
    return rows.filter((r) => {
      try {
        const parsed: ModerationCategoryScore[] = JSON.parse(r.categories)
        return parsed.some((c) => categoryFilter.includes(c.category))
      } catch {
        return false
      }
    }).length
  }
  const { rows } = await q<{ count: string }>(
    `SELECT COUNT(*) AS count FROM moderation_events WHERE user_id = $1 AND decision = 'block' AND created_at > $2`,
    [userId, sinceMs]
  )
  return Number(rows[0]?.count ?? 0)
}

/**
 * The shared, distributed replacement for lib/apiRateLimit.ts's in-memory
 * isRateLimited() — specifically for image-moderation uploads (see
 * lib/imageModeration/index.ts), where the caller can be either of the two
 * separately-deployed processes this repo runs as (see migration
 * 0007_image_moderation_rate_limits's own comment). Backed by one row per
 * (userId, surface) in image_moderation_rate_limits — a fixed window
 * counter, not a per-attempt log.
 *
 * The INSERT ... ON CONFLICT below reads and increments in one atomic
 * round trip: Postgres serializes concurrent upserts to the same row, so
 * two requests for the same account+surface landing on two different
 * instances at the same instant still can't both "win" a race and both
 * see a stale pre-increment count — one of them genuinely executes after
 * the other. When the existing row's window has already elapsed, the same
 * statement resets it to a fresh window with count 1 instead of
 * incrementing.
 *
 * This is a FIXED window, not the sliding window isRateLimited() used —
 * Postgres has no equivalent of a sorted-set structure to implement a true
 * sliding window without either an unbounded per-attempt log (defeating
 * the point of a bounded table) or multiple round trips per check. The
 * known, accepted tradeoff: a burst can allow up to roughly 2x the limit
 * across a window boundary (the tail of one window plus the head of the
 * next). For upload throttling, not a security boundary on its own — it
 * works alongside, not instead of, moderation itself and the separate
 * abuse-escalation ladder (lib/imageModeration/abuse.ts) — this is an
 * acceptable, standard tradeoff, not an oversight.
 *
 * Returns whether this attempt is OVER the limit (true = rate limited) —
 * same boolean contract as isRateLimited(), so lib/imageModeration/
 * index.ts's call site reads the same either way.
 */
export async function checkAndIncrementImageModerationRateLimit(
  userId: string,
  surface: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const { rows } = await q<{ count: number }>(
    `INSERT INTO image_moderation_rate_limits (user_id, surface, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, surface) DO UPDATE
     SET count = CASE
           WHEN image_moderation_rate_limits.window_start = EXCLUDED.window_start
           THEN image_moderation_rate_limits.count + 1
           ELSE 1
         END,
         window_start = EXCLUDED.window_start
     RETURNING count`,
    [userId, surface, windowStart]
  )
  return (rows[0]?.count ?? 0) > limit
}

/**
 * The shared, distributed replacement for lib/apiRateLimit.ts's in-memory
 * isRateLimited() — specifically for TURN credential issuance (see
 * app/api/realtime/turn/route.ts and lib/turnCredentials.ts), where Vercel
 * may run that route on any of several serverless instances that share no
 * memory with each other, so an in-memory limiter there was never actually
 * authoritative across them.
 *
 * Same atomic fixed-window UPSERT technique as
 * checkAndIncrementImageModerationRateLimit() just above — see its own doc
 * comment for the full reasoning (race-safety via Postgres's own row-level
 * serialization on the UPSERT, the accepted "up to ~2x across a window
 * boundary" fixed-window tradeoff, bounded storage with no cleanup job
 * needed since each account owns exactly one row, reused/reset in place
 * rather than accumulated). Kept as its own dedicated
 * turn_credential_rate_limits table rather than reusing
 * image_moderation_rate_limits — a different feature's own table, with its
 * own (userId, surface) shape this doesn't need.
 *
 * The caller (app/api/realtime/turn/route.ts) is what actually fails
 * closed: this function throws like any other query on a genuine database
 * failure (never silently treats an error as "not limited") and the route
 * itself refuses to mint a credential unless this resolves successfully —
 * a database outage means no credentials are issued, not unlimited ones.
 *
 * Returns whether this attempt is OVER the limit (true = rate limited).
 */
export async function checkAndIncrementTurnCredentialRateLimit(userId: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const { rows } = await q<{ count: number }>(
    `INSERT INTO turn_credential_rate_limits (user_id, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id) DO UPDATE
     SET count = CASE
           WHEN turn_credential_rate_limits.window_start = EXCLUDED.window_start
           THEN turn_credential_rate_limits.count + 1
           ELSE 1
         END,
         window_start = EXCLUDED.window_start
     RETURNING count`,
    [userId, windowStart]
  )
  return (rows[0]?.count ?? 0) > limit
}

/** Keys are hashed to avoid putting stable account identifiers in limiter storage. */
export async function checkAndIncrementApiRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const { createHash } = await import("node:crypto")
  const keyHash = createHash("sha256").update(key).digest("hex")
  const ts = now()
  const { rows } = await q<{ count: number }>(`
    INSERT INTO api_rate_limits(key,window_start,expires_at,count) VALUES($1,$2,$3,1)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN api_rate_limits.expires_at <= $2 THEN 1 ELSE LEAST(api_rate_limits.count + 1, 1000000) END,
      window_start=CASE WHEN api_rate_limits.expires_at <= $2 THEN $2 ELSE api_rate_limits.window_start END,
      expires_at=CASE WHEN api_rate_limits.expires_at <= $2 THEN $3 ELSE api_rate_limits.expires_at END
    RETURNING count`, [keyHash, ts, ts + windowMs])
  return Number(rows[0].count) > limit
}

export async function lookupExistingTarget(userId: string): Promise<boolean> {
  if (!isWireId(userId)) return false
  const { rows } = await q(`SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId])
  return rows.length > 0
}

/** Only server-established social relationships authorize off-call raw-ID targets. */
export async function canTargetUser(actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId || !await lookupExistingTarget(targetId)) return false
  const { rows } = await q(`SELECT 1 FROM friendships WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)
    UNION ALL SELECT 1 FROM friend_requests WHERE status='pending' AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) LIMIT 1`, [actorId, targetId])
  return rows.length > 0
}

export async function checkDatabaseReady(): Promise<void> { await q('SELECT 1') }

/** Run hourly from the operator scheduler or persistent realtime process. */
export async function cleanupEphemeralRecords(): Promise<void> {
  const { RETENTION } = await import("./retention")
  const cutoff = now() - RETENTION.expiredRateLimitGraceMs
  await q('DELETE FROM api_rate_limits WHERE expires_at < $1', [cutoff])
  await q('DELETE FROM image_moderation_rate_limits WHERE window_start < $1', [cutoff - RETENTION.imageRateWindowMs])
  await q('DELETE FROM turn_credential_rate_limits WHERE window_start < $1', [cutoff - RETENTION.turnRateWindowMs])
  const backlog = await q<{ count: string; urgent: string }>("SELECT count(*) AS count, count(*) FILTER (WHERE priority='urgent') AS urgent FROM reports WHERE status='pending'")
  log.info("moderation.backlog", { count: Number(backlog.rows[0].count) })
  log.info("moderation.urgent_backlog", { count: Number(backlog.rows[0].urgent) })
}

/** Restricted caller must verify the requester's identity and record a case reference. */
export async function exportUserData(userId: string, actorId: string, caseReference: string) {
  if (!await lookupExistingTarget(userId)) throw new Error("not_found")
  const results = await Promise.all([
    q('SELECT username,gender,profile_photo,bio,created_at,deleted_at FROM users WHERE id=$1', [userId]),
    q('SELECT id,data_url,created_at FROM user_posts WHERE user_id=$1', [userId]),
    q('SELECT f.id, u.username AS other_username, f.created_at FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END WHERE f.user_a_id=$1 OR f.user_b_id=$1', [userId]),
    q('SELECT id,status,created_at,resolved_at,(sender_id=$1) AS sent_by_you FROM friend_requests WHERE sender_id=$1 OR recipient_id=$1', [userId]),
    q('SELECT id,friendship_id,text,created_at,read_at,reply_to_id,(sender_id=$1) AS sent_by_you FROM friend_messages WHERE sender_id=$1 OR (recipient_id=$1 AND EXISTS(SELECT 1 FROM friendships f WHERE f.id=friendship_id)) ORDER BY created_at', [userId]),
    q('SELECT u.username,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE blocker_id=$1', [userId]),
    q('SELECT document,version,accepted_at FROM legal_acceptance WHERE user_id=$1 ORDER BY accepted_at', [userId]),
    q('SELECT status,paid_until FROM billing_subscriptions WHERE user_id=$1', [userId]),
    q(`SELECT m.id,m.source,m.started_at,m.ended_at,m.report_eligible_until,u.username AS counterpart_username,
      EXISTS(SELECT 1 FROM reports r WHERE r.match_id=m.id AND r.reporter_id=$1) AS reported_by_you
      FROM match_sessions m JOIN users u ON u.id=CASE WHEN m.user_a_id=$1 THEN m.user_b_id ELSE m.user_a_id END
      WHERE m.user_a_id=$1 OR m.user_b_id=$1 ORDER BY m.started_at`, [userId]),
    q(`SELECT a.id,a.enforcement_id,m.action,r.category,a.reason,a.evidence_reference,a.submitted_at,a.status,a.resolution,a.resolved_at
      FROM appeals a JOIN moderation_actions m ON m.id=a.enforcement_id LEFT JOIN reports r ON r.id=m.report_id
      WHERE a.user_id=$1 ORDER BY a.submitted_at`, [userId]),
  ])
  await q('INSERT INTO privacy_operations(id,user_id,actor_id,action,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),userId,actorId,'export',caseReference,now()])
  return { exportedAt: now(), profile: results[0].rows[0], posts: results[1].rows, friendships: results[2].rows,
    requests: results[3].rows, messages: results[4].rows, blocks: results[5].rows, legalAcceptances: results[6].rows, subscriptions: results[7].rows,
    recentMatches: results[8].rows, appeals: results[9].rows }
}

/** Erases product data; keeps an inaccessible identity tombstone and safety/legal audit records.
 * Cases needing a legal hold must not use this operation until reviewed. */
export async function eraseUserData(userId: string, actorId: string, caseReference: string): Promise<{ productErased: true; storagePending: number }> {
  await ensureMigrated()
  const client = await requirePool().connect()
  const removedImages: unknown[] = []
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_holds IN SHARE MODE')
    if ((await client.query('SELECT 1 FROM legal_holds WHERE released_at IS NULL LIMIT 1')).rowCount) throw new Error('active_legal_hold')
    const account = await client.query('SELECT id,profile_photo FROM users WHERE id=$1 FOR UPDATE', [userId])
    if (!account.rowCount) throw new Error('not_found')
    const prior = await client.query("SELECT retained FROM privacy_operations WHERE user_id=$1 AND action='erase' ORDER BY created_at DESC LIMIT 1", [userId])
    if (Array.isArray(prior.rows[0]?.retained?.imageReferences)) removedImages.push(...prior.rows[0].retained.imageReferences)
    // Paid accounts require separate verified cancellation/finance handling.
    const paid = await client.query("SELECT 1 FROM billing_customers WHERE user_id=$1", [userId])
    if (paid.rowCount) throw new Error('billing_review_required')
    await client.query('DELETE FROM friend_messages WHERE sender_id=$1 OR recipient_id=$1', [userId])
    await client.query('DELETE FROM friendships WHERE user_a_id=$1 OR user_b_id=$1', [userId])
    await client.query('DELETE FROM blocks WHERE blocker_id=$1 OR blocked_id=$1', [userId])
    await client.query('DELETE FROM friend_requests WHERE sender_id=$1 OR recipient_id=$1', [userId])
    const posts = await client.query('DELETE FROM user_posts WHERE user_id=$1 RETURNING data_url', [userId])
    removedImages.push(account.rows[0].profile_photo, ...posts.rows.map(row => row.data_url))
    await client.query('DELETE FROM billing_subscriptions WHERE user_id=$1', [userId])
    await client.query('DELETE FROM image_moderation_rate_limits WHERE user_id=$1', [userId])
    await client.query('DELETE FROM turn_credential_rate_limits WHERE user_id=$1', [userId])
    await client.query('UPDATE users SET username=NULL,gender=NULL,profile_photo=NULL,bio=NULL,deleted_at=$2 WHERE id=$1', [userId,now()])
    for (const reference of new Set(removedImages)) if (storedImageKey(reference)) await client.query('INSERT INTO image_deletion_queue(reference,created_at) VALUES($1,$2) ON CONFLICT DO NOTHING', [reference,now()])
    await client.query('INSERT INTO privacy_operations(id,user_id,actor_id,action,reason,created_at,retained) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(),userId,actorId,'erase',caseReference,now(),JSON.stringify({ imageReferences: [...new Set(removedImages.filter(reference=>storedImageKey(reference)))], heldRecords: "Previously held pre-change records follow separately approved preservation retention; referenced objects remain restricted", identity: "Deleted identity prevents reentry", recentMatches: "Minimal safety-reporting ledger, subject to approved recent-match retention", reports: "Restricted safety investigation and evidence, subject to approved retention", moderation: "Restricted enforcement, appeal and image-check history, subject to approved retention", legalAcceptance: "Acceptance evidence, subject to approved retention", privacyOperations: "Accountability for this request, subject to approved retention", imageDeletion: "Durable deletion queue; Storage completion separately checked" })])
    await client.query('COMMIT')
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err }
  finally { client.release() }
  // Failure is visible and retryable; do not claim erasure completed while objects remain.
  for (const reference of new Set(removedImages)) if (storedImageKey(reference)) await deleteQueuedImage(String(reference))
  const pending = await q<{count:string}>('SELECT count(*) AS count FROM image_deletion_queue WHERE reference=ANY($1::text[])', [removedImages.filter(reference=>storedImageKey(reference))])
  return { productErased: true, storagePending: Number(pending.rows[0].count) }
}

/** References remain readable during the legacy data-URL migration. Removed or
 * erased profile/post objects immediately stop being served by the media route. */
export async function isStoredImageReferenced(reference: string): Promise<boolean> {
  const { rows } = await q<{ present: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM users WHERE profile_photo=$1 AND deleted_at IS NULL AND banned_at IS NULL
    UNION ALL SELECT 1 FROM user_posts p JOIN users u ON u.id=p.user_id
      WHERE p.data_url=$1 AND u.deleted_at IS NULL AND u.banned_at IS NULL
  ) AS present`, [reference])
  return rows[0].present
}

/** The holds table lock prevents a concurrent hold from racing a deletion. */
async function deleteQueuedImage(reference: string) {
  const client = await requirePool().connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_holds IN SHARE MODE')
    if ((await client.query('SELECT 1 FROM legal_holds WHERE released_at IS NULL LIMIT 1')).rowCount) throw new Error('active_legal_hold')
    const queued = await client.query('SELECT reference FROM image_deletion_queue WHERE reference=$1 FOR UPDATE', [reference])
    if (queued.rowCount) {
      const used = await client.query(`SELECT 1 FROM users WHERE profile_photo=$1 UNION ALL SELECT 1 FROM user_posts WHERE data_url=$1 UNION ALL SELECT 1 FROM held_records WHERE snapshot::text LIKE '%' || $1 || '%' LIMIT 1`, [reference])
      if (!used.rowCount) {
        await deleteStoredImage(reference)
        await client.query('DELETE FROM image_deletion_queue WHERE reference=$1', [reference])
      } else await client.query('UPDATE image_deletion_queue SET next_attempt_at=$2 WHERE reference=$1',[reference,now()+3_600_000])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    await q('UPDATE image_deletion_queue SET attempts=attempts+1,next_attempt_at=$2 WHERE reference=$1', [reference,now()+60_000])
    throw error
  } finally { client.release() }
}

/** One bounded pass. Operator scheduler must monitor errors and backlog. */
export async function purgeRetentionBatch(batchSize = 100) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('invalid_batch_size')
  const { retentionPolicy } = await import('./retention')
  const policy = retentionPolicy()
  await ensureMigrated()
  const client = await requirePool().connect()
  const counts: Record<string, number> = {}
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_holds IN SHARE MODE')
    if ((await client.query('SELECT 1 FROM legal_holds WHERE released_at IS NULL LIMIT 1')).rowCount) {
      await client.query('COMMIT'); return { held: true, counts }
    }
    // Referenced replies, report/action links and safety decisions delay deletion
    // until dependent records expire; no cascade silently bypasses their policy.
    const specs = [
      ['friendMessages','friend_messages','created_at', "NOT EXISTS(SELECT 1 FROM friend_messages reply WHERE reply.reply_to_id=t.id)"],
      ['friendRequests','friend_requests','created_at','true'],
      ['appeals','appeals','submitted_at', "status IN ('upheld','overturned','dismissed')"],
      ['moderationActions','moderation_actions','created_at','NOT EXISTS(SELECT 1 FROM appeals a WHERE a.enforcement_id=t.id)'],
      ['reportEvidence','report_evidence','captured_at', "evidence_key IS NULL AND EXISTS(SELECT 1 FROM reports r WHERE r.id=t.report_id AND r.status='reviewed' AND r.safety_state<>'open')"],
      ['reports','reports','created_at', "status='reviewed' AND safety_state<>'open' AND NOT EXISTS(SELECT 1 FROM moderation_actions a WHERE a.report_id=t.id) AND NOT EXISTS(SELECT 1 FROM safety_decisions d WHERE d.report_id=t.id) AND NOT EXISTS(SELECT 1 FROM report_evidence e WHERE e.report_id=t.id)"],
      ['recentMatches','match_sessions','started_at', "report_eligible_until<extract(epoch from clock_timestamp())*1000 AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.match_id=t.id)"],
      ['imageChecks','moderation_events','created_at','true'],
      ['legalAcceptance','legal_acceptance','accepted_at', "EXISTS(SELECT 1 FROM users u WHERE u.id=t.user_id AND u.deleted_at IS NOT NULL)"],
      ['privacyOperations','privacy_operations','created_at','true'],
      ['heldRecords','held_records','created_at','true'],
    ] as const
    for (const [category, table, timestamp, condition] of specs) {
      const rule = policy.categories[category]
      if (rule.mode !== 'automatic') continue
      const cutoff = now() - rule.days! * 86_400_000
      if (category === 'reports') {
        // Decisions share the report policy, but unresolved investigations stay.
        await client.query("DELETE FROM safety_decisions WHERE id IN (SELECT d.id FROM safety_decisions d JOIN reports r ON r.id=d.report_id WHERE r.status='reviewed' AND r.safety_state<>'open' AND d.created_at<$1 AND r.created_at<$1 ORDER BY d.created_at LIMIT $2)", [cutoff,batchSize])
      }
      const key = category === 'reportEvidence' ? 'report_id' : 'id'
      const result = await client.query(`DELETE FROM ${table} WHERE ${key} IN (SELECT t.${key} FROM ${table} t WHERE t.${timestamp}<$1 AND ${condition} ORDER BY t.${timestamp} LIMIT $2 FOR UPDATE SKIP LOCKED)`, [cutoff,batchSize])
      counts[category] = result.rowCount ?? 0
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
  const queued = await q<{ reference: string }>('SELECT reference FROM image_deletion_queue WHERE next_attempt_at<=$2 ORDER BY created_at LIMIT $1', [batchSize,now()])
  for (const row of queued.rows) await deleteQueuedImage(row.reference)
  return { held: false, counts }
}

export async function getReportEvidence(reportId: string, actorId: string) {
  const result = await q('SELECT e.* FROM report_evidence e JOIN reports r ON r.id=e.report_id WHERE e.report_id=$1 AND r.reported_id<>$2', [reportId,actorId])
  if (result.rowCount) await q('INSERT INTO safety_decisions(id,report_id,actor_id,decision,case_reference,rationale,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(),reportId,actorId,'evidence_access',reportId,'Restricted moderator evidence view',now()])
  return result.rows[0] ?? null
}

export async function recordSafetyDecision(input: { reportId: string; actorId: string; decision: string; caseReference: string; rationale: string; externalReference?: string }) {
  await ensureMigrated()
  const client = await requirePool().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT id,reported_id FROM reports WHERE id=$1 FOR UPDATE', [input.reportId])
    if (!result.rowCount) throw new Error('report_not_found')
    if (result.rows[0].reported_id === input.actorId) throw new Error('conflicted_reviewer')
    await client.query('INSERT INTO safety_decisions(id,report_id,actor_id,decision,case_reference,rationale,external_reference,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(),input.reportId,input.actorId,input.decision,input.caseReference,input.rationale,input.externalReference ?? null,now()])
    if (input.decision === 'investigation_open' || input.decision === 'investigation_closed') await client.query('UPDATE reports SET safety_state=$2 WHERE id=$1', [input.reportId,input.decision === 'investigation_open' ? 'open' : 'closed'])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function setLegalHold(actorId: string, caseReference: string, reason: string, releaseId?: string) {
  if (releaseId) {
    const result = await q('UPDATE legal_holds SET released_at=$2,released_by=$3,release_reason=$4 WHERE id=$1 AND released_at IS NULL', [releaseId,now(),actorId,`${caseReference}: ${reason}`])
    if (!result.rowCount) throw new Error('hold_not_found')
    return releaseId
  }
  const id = randomUUID()
  await q('INSERT INTO legal_holds(id,case_reference,reason,created_by,created_at) VALUES($1,$2,$3,$4,$5)', [id,caseReference,reason,actorId,now()])
  return id
}

/** Storage inventory is separate from Postgres deletion; repeated complete scans
 * catch uploads interrupted before a DB reference or deletion job was written. */
export async function discoverOrphanedImages(offset = 0, batchSize = 100) {
  const { listStoredImages, isImageKey } = await import('./imageStorage')
  const { retentionPolicy } = await import('./retention')
  const policy = retentionPolicy()
  const rows = await listStoredImages(offset,batchSize)
  const cutoff = now() - policy.categories.storedImages.days! * 86_400_000
  for (const row of rows) {
    if (!isImageKey(row.name) || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) >= cutoff) continue
    const reference = `/api/media/${row.name}`
    await q(`INSERT INTO image_deletion_queue(reference,created_at) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM users WHERE profile_photo=$1 UNION ALL SELECT 1 FROM user_posts WHERE data_url=$1) ON CONFLICT DO NOTHING`, [reference,now()])
  }
  return { nextOffset: rows.length === batchSize ? offset + batchSize : null }
}

/** One round trip for current account and legal eligibility, including live sockets. */
export async function realtimeAccess(userIds: string[]): Promise<Map<string, "allowed" | "banned" | "restricted" | "suspended" | "acceptance_required">> {
  if (userIds.length > 500) throw new Error('eligibility_batch_too_large')
  const result = await q<{id:string; banned:boolean; suspended:boolean; restricted:boolean; accepted:boolean}>(`SELECT u.id,
    (u.deleted_at IS NOT NULL OR u.banned_at IS NOT NULL) AS banned,
    COALESCE(u.suspended_until>$3,false) AS suspended,
    COALESCE(u.suspended_until>$3 AND EXISTS(SELECT 1 FROM moderation_actions m WHERE m.target_user_id=u.id AND m.action='restrict' AND m.suspend_until=u.suspended_until),false) AS restricted,
    NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS required(document text,version text)
      WHERE NOT EXISTS(SELECT 1 FROM legal_acceptance a WHERE a.user_id=u.id AND a.document=required.document AND a.version=required.version)) AS accepted
    FROM users u WHERE u.id=ANY($1::text[])`,[userIds,JSON.stringify(REQUIRED_DOCUMENTS),now()])
  return new Map(result.rows.map(row=>[row.id,row.banned?'banned':row.restricted?'restricted':row.suspended?'suspended':!row.accepted?'acceptance_required':'allowed']))
}
