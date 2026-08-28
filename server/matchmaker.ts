import { randomUUID } from "node:crypto"
import type { Gender } from "../lib/signaling/protocol"
import { isBlockedEitherWay } from "../lib/db"

export type QueuedClient = {
  userId: string
  gender?: Gender
  enqueuedAt: number
  /** A per-connection debug id (server/ws-server.ts's ConnectionState.displayId) — what this class actually logs instead of the real Google `userId`, per the "prefer temporary connection/debug ids over raw Google ids" logging rule. Purely cosmetic for logging; every real lookup here still uses `userId`. */
  debugId: string
}

export type Room = {
  id: string
  a: string
  b: string
  createdAt: number
}

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
 * used to do everything in one pass: create the Room, wire up
 * `roomByGuest` for both sides, and record the recent-partner cooldown, all
 * *before* server/ws-server.ts had verified either side's ConnectionState
 * still actually existed. Since `reserveMatch` spans a real `await`
 * (the block-list check), either side can disconnect while it's pending —
 * and committing a room for a connection that's already gone left a ghost
 * room (`roomByGuest` entries nothing would ever clear) and burned a
 * cooldown for a match that never actually happened. Now: `reserveMatch`
 * only removes both candidates from `waiting` and creates the room-in-
 * limbo; the caller (server/ws-server.ts) verifies both ConnectionStates
 * are still live and only then calls `commitMatch` (records the cooldown)
 * — or `rollbackMatch` (deletes the room entirely, no cooldown, optionally
 * re-queues whichever side is still actually connected) if verification
 * fails.
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
  private isOppositeGender(a: QueuedClient, b: QueuedClient): boolean {
    return Boolean(a.gender && b.gender && a.gender !== b.gender)
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
   * `isLive` (backed by server/ws-server.ts's own `connections` map — this
   * class has no visibility into WebSocket connections itself) to revalidate
   * BOTH sides right before committing to a candidate. Returns a room the
   * caller must follow up on with `commitMatch`/`rollbackMatch`, or null if
   * `client` is now waiting instead.
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
  async reserveMatch(client: QueuedClient, isLive: (userId: string) => boolean): Promise<Room | null> {
    this.removeFromQueue(client.userId)
    console.log("matchmaker: queue entered", { debugId: client.debugId, queueSize: this.waiting.length })

    for (const candidate of [...this.waiting]) {
      console.log("matchmaker: candidate considered", { debugId: client.debugId, candidateDebugId: candidate.debugId })

      if (!this.isOppositeGender(client, candidate)) {
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

      // Revalidate BOTH accounts after the async gap above — either side
      // could have disconnected, been re-queued, or already matched
      // elsewhere while this candidate's block check was in flight.
      const candidateStillWaiting = this.waiting.some((c) => c.userId === candidate.userId)
      if (!candidateStillWaiting || !isLive(candidate.userId)) {
        console.log("matchmaker: candidate disappeared", { debugId: client.debugId, candidateDebugId: candidate.debugId })
        continue
      }
      if (!isLive(client.userId)) {
        // The INITIATING client itself vanished while this candidate's
        // block check was pending — there's no one left to match, and no
        // point trying further candidates on behalf of a connection that's
        // already gone. Leave `candidate` waiting for the next comer.
        console.log("matchmaker: initiator disappeared mid-check — abandoning this attempt", { debugId: client.debugId })
        return null
      }

      // Reserve: remove the candidate now, before any further `await` — no
      // other candidate loop can observe `waiting` between here and the
      // synchronous room-bookkeeping below (this function isn't re-entrant
      // mid-loop; the only `await` was already above, and everything past
      // this point is synchronous).
      this.waiting = this.waiting.filter((c) => c.userId !== candidate.userId)
      const room: Room = { id: randomUUID(), a: client.userId, b: candidate.userId, createdAt: Date.now() }
      this.rooms.set(room.id, room)
      this.roomByGuest.set(room.a, room.id)
      this.roomByGuest.set(room.b, room.id)
      console.log("matchmaker: pair reserved", { roomId: room.id, debugId: client.debugId, candidateDebugId: candidate.debugId })
      // Deliberately NOT calling remember() here — that's commitMatch()'s
      // job, once the caller has actually confirmed this room is real.
      return room
    }

    this.waiting.push(client)
    return null
  }

  /** Phase 2a — confirms a reservation actually turned into a real match: records the recent-partner cooldown now, not at reservation time (see the class doc comment for why that distinction matters). */
  commitMatch(roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) return
    this.remember(room.a, room.b)
    console.log("matchmaker: pair committed", { roomId })
  }

  /**
   * Phase 2b — undoes a reservation that failed verification: deletes the
   * room and both `roomByGuest` entries entirely (no ghost room left
   * behind), and — since no cooldown was ever recorded for a reservation
   * that's being rolled back — there's nothing to undo there either.
   * `requeue`, if given, is pushed back into `waiting` — the side of the
   * failed pair that's still actually connected and eligible to keep
   * looking, so a verification failure doesn't just strand them outside the
   * queue with no way back in short of manually pressing find again.
   */
  rollbackMatch(roomId: string, requeue: QueuedClient | null) {
    const room = this.rooms.get(roomId)
    if (room) {
      this.roomByGuest.delete(room.a)
      this.roomByGuest.delete(room.b)
      this.rooms.delete(roomId)
    }
    if (requeue) {
      this.removeFromQueue(requeue.userId)
      this.waiting.push(requeue)
    }
    console.log("matchmaker: pair rollback", { roomId, requeued: Boolean(requeue), reason: "connection verification failed" })
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
