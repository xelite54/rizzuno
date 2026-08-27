import { randomUUID } from "node:crypto"
import type { Gender } from "../lib/signaling/protocol"
import { isBlockedEitherWay } from "../lib/db"

export type QueuedClient = {
  userId: string
  gender?: Gender
  enqueuedAt: number
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
 * `enqueue` is async now (the block check is a real database round trip)
 * — see server/ws-server.ts's caller, which awaits it. Everything else
 * about the matching algorithm is unchanged.
 *
 * This queue lives in one process's memory, correct for exactly the one
 * realtime instance this is meant to run as (see server.ts). Running more
 * than one realtime instance at once would need this queue moved to a
 * shared store (e.g. Redis) — two instances each holding a different half
 * of the waiting list would otherwise just never match each other.
 */
class Matchmaker {
  private waiting: QueuedClient[] = []
  private rooms = new Map<string, Room>()
  private roomByGuest = new Map<string, string>()
  private recentPartners = new Map<string, Map<string, number>>()

  removeFromQueue(userId: string) {
    this.waiting = this.waiting.filter((c) => c.userId !== userId)
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

  private async canMatch(a: QueuedClient, b: QueuedClient): Promise<boolean> {
    if (a.userId === b.userId) return false
    if (!this.isOppositeGender(a, b)) return false
    if (this.isRecentPartner(a.userId, b.userId)) return false
    if (await isBlockedEitherWay(a.userId, b.userId)) return false
    return true
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
   * Tries to pair `client` with someone already waiting. Returns the new
   * room, or null if `client` is now waiting.
   *
   * Checks candidates in queue order (cheap, synchronous checks first —
   * gender, recent-partner — before the async database block check) and
   * takes the first compatible one, same behavior as the previous
   * synchronous version. Re-checks `client` hasn't been re-queued or
   * matched elsewhere while an earlier candidate's block check was in
   * flight (possible now that this spans real await points) — if so, bail
   * out rather than double-match them.
   */
  async enqueue(client: QueuedClient): Promise<Room | null> {
    this.removeFromQueue(client.userId)

    for (const candidate of [...this.waiting]) {
      if (!this.isOppositeGender(client, candidate)) continue
      if (this.isRecentPartner(client.userId, candidate.userId)) {
        // Logged specifically so "these two won't match" during manual
        // testing can be told apart at a glance from a real bug — this
        // candidate is skipped ONLY relative to `client`, not removed from
        // the queue, and remains a normal candidate for anyone else.
        console.log("matchmaker: skipping candidate — recent-partner cooldown", {
          userId: client.userId,
          candidateId: candidate.userId,
        })
        continue
      }
      if (!(await isBlockedEitherWay(client.userId, candidate.userId))) {
        // Still both actually waiting for each other after the await —
        // guards against a race where either side left the queue (skip,
        // leave, disconnect, or already matched by a concurrent call)
        // while this candidate's block check was pending.
        const stillWaiting = this.waiting.some((c) => c.userId === candidate.userId)
        if (!stillWaiting) continue

        this.waiting = this.waiting.filter((c) => c.userId !== candidate.userId)
        const room: Room = { id: randomUUID(), a: client.userId, b: candidate.userId, createdAt: Date.now() }
        this.rooms.set(room.id, room)
        this.roomByGuest.set(room.a, room.id)
        this.roomByGuest.set(room.b, room.id)
        this.remember(room.a, room.b)
        return room
      }
    }

    this.waiting.push(client)
    return null
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
