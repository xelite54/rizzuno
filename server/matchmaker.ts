import { randomUUID } from "node:crypto"
import type { Gender } from "../lib/signaling/protocol"
import { isBlockedEitherWay } from "../lib/db"

export type QueuedClient = {
  userId: string
  gender?: Gender
  enqueuedAt: number
  /** A per-connection debug id (server/ws-server.ts's ConnectionState.displayId) — what this class actually logs instead of the real Google `userId`, per the "prefer temporary connection/debug ids over raw Google ids" logging rule. Purely cosmetic for logging; every real lookup here still uses `userId`. */
  debugId: string
  /**
   * The account's `searchGeneration` (server/ws-server.ts's ConnectionState
   * field) at the moment this entry was queued — the authoritative proof
   * that this specific queue entry still corresponds to the account's
   * CURRENT search intent. server/ws-server.ts increments the live
   * generation on every "find" and, critically, on every "leave"/pause/
   * camera-off/disconnect too — synchronously, immediately on receiving
   * that message, never waiting behind an in-flight async match attempt
   * (see its own doc comments). So if a match attempt is still holding a
   * candidate's snapshot from `waiting` with an older generation than the
   * account's live one by the time an async boundary is crossed, that
   * snapshot is provably stale — the account either left, paused, or
   * started an entirely new search since — and must never be matched
   * against.
   */
  searchGeneration: number
}

export type Room = {
  id: string
  a: string
  b: string
  /** The `searchGeneration` each side had at the moment this room was reserved — re-checked (via `CheckLive`) right before actually committing, since a further async gap (the Friends lookup) sits between reservation and commit too. */
  aGeneration: number
  bGeneration: number
  createdAt: number
}

/**
 * Server-authoritative eligibility check for one account, supplied by
 * server/ws-server.ts (this module has no visibility into WebSocket
 * connections itself). Must verify — all of it, freshly, not from any
 * snapshot — that the account is: still registered, on an OPEN socket,
 * still actively `seeking`, still on the exact `searchGeneration` being
 * asked about (a mismatch means the account left/paused/re-searched since
 * whoever's asking last knew about it), and not already in a room. Returns
 * the account's LIVE current gender alongside `live` so callers can also
 * re-verify a pairing is still opposite-gender using up-to-date data, not a
 * possibly-stale queued snapshot.
 */
export type CheckLive = (userId: string, expectedGeneration: number) => { live: boolean; gender?: Gender }

// How long two people who just talked stay off each other's candidate list
// (spec §32: no repeated people right after a skip). Scoped to the exact
// pair — see isRecentPartner()/remember() below, both keyed on the specific
// (a, b) userId pair via a nested Map, never on just one side alone — so
// this can only ever keep two people who already matched from immediately
// re-matching each other; it has no way to affect matching between anyone
// else, including a third account either of them later queues up against.
// If matching between two accounts that have *never* met seems blocked,
// this cooldown is not why; look at gender pairing or blocks instead.
//
// This lives in `recentPartners`, in-process memory (see the class doc
// comment below) — restarting the single Railway process (or the local dev
// server) clears it completely. That's expected, not a bug: it's exactly
// how you get two test accounts to immediately re-match each other while
// testing locally, without waiting out the full 10 minutes. Production
// behavior is unaffected by that — Railway isn't restarting mid-session
// under normal operation, and this cooldown existing at all, even
// imperfectly durable, is what the spec actually asks for.
const RECENT_PARTNER_TTL_MS = 10 * 60 * 1000

/**
 * In-memory matching engine. The queue and active-room state are still
 * in-memory (there's no product reason to survive a restart mid-search —
 * everyone just re-enters the queue), but blocks are checked against the
 * shared Postgres database (see lib/db.ts) — not local memory — so a block
 * made through either the Vercel app or another realtime instance is
 * respected here immediately.
 *
 * `reserveMatch` is async now (the block check is a real database round
 * trip) — see server/ws-server.ts's caller, which awaits it.
 *
 * This queue lives in one process's memory, correct for exactly the one
 * realtime instance this is meant to run as (see server.ts). Running more
 * than one realtime instance at once would need this queue moved to a
 * shared store (e.g. Redis) — two instances each holding a different half
 * of the waiting list would otherwise just never match each other.
 *
 * MATCHING IS TWO-PHASE — reserve, then commit or roll back. `reserveMatch`
 * only removes both candidates from `waiting` and creates the room-in-
 * limbo; the caller (server/ws-server.ts) crosses at least one more async
 * boundary of its own (the Friends lookup), re-verifies BOTH accounts are
 * still genuinely eligible using the SAME authoritative `CheckLive` — not
 * presence in a Map, not a snapshot taken before any of this started — and
 * only then calls `commitMatch` (records the cooldown, only now) or
 * `deleteReservation` + `requeue` (whoever's still actually eligible) if
 * that final check fails. See CheckLive's own doc comment for exactly what
 * "eligible" means and why presence alone was never enough — an account can
 * remain present in `connections` while having explicitly paused, turned
 * its camera off, or started a completely different search in the
 * meantime, none of which change whether `connections.has(userId)` is true.
 */
// Exported (not just the singleton instance below) specifically so
// tests/matchmaker.test.mts can instantiate isolated instances — the real
// app only ever needs the one singleton, but a shared singleton across many
// test cases would let one test's unmatched leftovers (still sitting in
// `waiting`) interfere with a later, unrelated test's assumptions about who
// else is in the queue.
export class Matchmaker {
  private waiting: QueuedClient[] = []
  private rooms = new Map<string, Room>()
  private roomByGuest = new Map<string, string>()
  private recentPartners = new Map<string, Map<string, number>>()

  removeFromQueue(userId: string) {
    this.waiting = this.waiting.filter((c) => c.userId !== userId)
  }

  /** Pushes one account back into the waiting queue, deduped by userId first (same as a normal "find" would insert them) — used to requeue a still-eligible survivor after a reservation/final-commit check fails for the other side. */
  requeue(client: QueuedClient) {
    this.removeFromQueue(client.userId)
    this.waiting.push(client)
  }

  get queueSize(): number {
    return this.waiting.length
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  private isRecentPartner(a: string, b: string): boolean {
    const seenAt = this.recentPartners.get(a)?.get(b)
    if (!seenAt) return false
    return Date.now() - seenAt < RECENT_PARTNER_TTL_MS
  }

  // Straight matching only: male only pairs with female and vice versa.
  // Missing gender on either side (shouldn't happen — the client requires
  // it before matching ever starts) is treated as "can't match" rather than
  // letting an unknown gender slip past the rule.
  private isOppositeGender(aGender: Gender | undefined, bGender: Gender | undefined): boolean {
    return Boolean(aGender && bGender && aGender !== bGender)
  }

  private remember(a: string, b: string) {
    const now = Date.now()
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!this.recentPartners.has(x)) this.recentPartners.set(x, new Map())
      const map = this.recentPartners.get(x)!
      map.set(y, now)
      if (map.size > 20) {
        const oldestKey = [...map.entries()].sort((p, q) => p[1] - q[1])[0]?.[0]
        if (oldestKey) map.delete(oldestKey)
      }
    }
  }

  /**
   * Phase 1 — tries to pair `client` with someone already waiting, using
   * `checkLive` to authoritatively revalidate BOTH sides right before
   * reserving a candidate (not just "were they still present a moment
   * ago"). Returns a room the caller must follow up on with
   * `commitMatch`/`deleteReservation`, or null if `client` is now waiting
   * instead.
   *
   * Checks candidates in queue order (cheap, synchronous checks first —
   * gender, recent-partner — before the async database block check). Every
   * candidate considered, and every reason one was passed over, is logged
   * with `debugId`s only, never a real Google id — purely so "these two
   * won't match" is diagnosable from Railway logs without exposing account
   * identity, and never sent to either client (telling a user *why* a
   * specific stranger wasn't offered to them would itself be a real
   * information leak, e.g. confirming a block exists).
   */
  async reserveMatch(client: QueuedClient, checkLive: CheckLive): Promise<Room | null> {
    this.removeFromQueue(client.userId)
    console.log("matchmaker: queue entered", { debugId: client.debugId, queueSize: this.waiting.length })

    for (const candidate of [...this.waiting]) {
      console.log("matchmaker: candidate considered", { debugId: client.debugId, candidateDebugId: candidate.debugId })

      if (!this.isOppositeGender(client.gender, candidate.gender)) {
        console.log("matchmaker: candidate skipped: same_gender", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }
      if (this.isRecentPartner(client.userId, candidate.userId)) {
        console.log("matchmaker: candidate skipped: recent_partner", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }

      const blocked = await isBlockedEitherWay(client.userId, candidate.userId)
      if (blocked) {
        console.log("matchmaker: candidate skipped: blocked", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }

      // Revalidate BOTH accounts after the async gap above, fully and
      // authoritatively (see CheckLive) — either side could have
      // disconnected, paused, turned its camera off, or started an
      // entirely different search while this candidate's block check was
      // in flight. `waiting.find` (not `.some`) plus a generation compare
      // — rather than just checking the userId is still present somewhere
      // in the queue — catches the specific case where the SAME account
      // left and re-queued (a brand new QueuedClient, replacing the stale
      // one this loop is still holding a snapshot of) while this was
      // pending: the userId would still be "present", but it's a different
      // search now.
      const currentEntry = this.waiting.find((c) => c.userId === candidate.userId)
      const candidateStillCurrent = currentEntry?.searchGeneration === candidate.searchGeneration
      const candidateCheck = candidateStillCurrent ? checkLive(candidate.userId, candidate.searchGeneration) : { live: false }
      if (!candidateCheck.live) {
        console.log("matchmaker: candidate disappeared", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }

      const clientCheck = checkLive(client.userId, client.searchGeneration)
      if (!clientCheck.live) {
        // The INITIATING client itself is no longer eligible (disconnected,
        // paused, or started a different search) while this candidate's
        // block check was pending — there's no one left to match on behalf
        // of, and no point trying further candidates for a request that's
        // already been superseded or abandoned. Leave `candidate` waiting
        // for the next comer.
        console.log("matchmaker: initiator no longer eligible mid-check — abandoning this attempt", { debugId: client.debugId })
        return null
      }

      // Final pairwise gender re-check using LIVE gender, not the queued
      // snapshot — a profile-update could have changed either side's
      // gender during the block-check await (the candidate's own
      // connection isn't blocked by this client's slow "find" the way the
      // client's own would be — see server/ws-server.ts's serialization
      // notes).
      if (!this.isOppositeGender(clientCheck.gender, candidateCheck.gender)) {
        console.log("matchmaker: candidate skipped: gender changed mid-check", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }

      // Reserve: remove the candidate now, before any further `await` — no
      // other candidate loop can observe `waiting` between here and the
      // synchronous room-bookkeeping below (this function isn't re-entrant
      // mid-loop; the only `await` was already above, and everything past
      // this point is synchronous).
      this.waiting = this.waiting.filter((c) => c.userId !== candidate.userId)
      const room: Room = {
        id: randomUUID(),
        a: client.userId,
        b: candidate.userId,
        aGeneration: client.searchGeneration,
        bGeneration: candidate.searchGeneration,
        createdAt: Date.now(),
      }
      this.rooms.set(room.id, room)
      this.roomByGuest.set(room.a, room.id)
      this.roomByGuest.set(room.b, room.id)
      console.log("matchmaker: pair reserved", { roomId: room.id, debugId: client.debugId, candidateDebugId: candidate.debugId })
      // Deliberately NOT calling remember() here — that's commitMatch()'s
      // job, once the caller has actually confirmed and dispatched a real
      // match (see the class doc comment).
      return room
    }

    this.waiting.push(client)
    return null
  }

  /** Phase 2a — confirms a reservation actually turned into a real, delivered match: records the recent-partner cooldown now, not at reservation time (see the class doc comment for why that distinction matters). */
  commitMatch(roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) return
    this.remember(room.a, room.b)
    console.log("matchmaker: pair committed", { roomId })
  }

  /**
   * Phase 2b — deletes a reservation's room mappings entirely (no ghost
   * room left behind) without recording any cooldown (none was ever
   * recorded for a reservation that never actually committed — see the
   * class doc comment). Requeueing whoever's still eligible is the CALLER's
   * job (via `requeue()` above) — a failed final check can leave EITHER,
   * NEITHER, or (rarely) effectively both sides needing to go back into the
   * queue (e.g. a gender change made the pairing invalid without either
   * side actually disconnecting), which is more than this method alone
   * can express with a single optional argument.
   */
  deleteReservation(roomId: string) {
    const room = this.rooms.get(roomId)
    if (room) {
      this.roomByGuest.delete(room.a)
      this.roomByGuest.delete(room.b)
      this.rooms.delete(roomId)
    }
    console.log("matchmaker: pair rollback", { roomId, reason: "final eligibility check failed before commit" })
  }

  leaveRoom(userId: string) {
    const roomId = this.roomByGuest.get(userId)
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (room) {
      this.roomByGuest.delete(room.a)
      this.roomByGuest.delete(room.b)
      this.rooms.delete(roomId)
    }
  }
}

export const matchmaker = new Matchmaker()
