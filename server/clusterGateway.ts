import { performance } from "node:perf_hooks"
import { EventEmitter } from "node:events"
import { createHash, randomUUID } from "node:crypto"
import { createClient } from "redis"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import { MAX_WS_PAYLOAD, isClientMessage } from "../lib/signaling/validation"
import { verifyTicket } from "../lib/realtimeTicket"
import { log } from "../lib/observability"

const LEASE_MS = 15_000
const RENEW_MS = 3_000
const prefix = "rizzuno:{realtime}:"
const leaseKey = `${prefix}lease`
const inputKey = `${prefix}commands`
const outputKey = `${prefix}events`
const appendFenced = `if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('XADD',KEYS[2],'MAXLEN','~',2000,'*','payload',ARGV[2])`
const renewFenced = `if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE',KEYS[1],ARGV[2])`
type BusEvent = { epoch: string; id: string; op: "open" | "message" | "close" | "pong" | "send" | "ping"; data?: string; code?: number }
type Redis = ReturnType<typeof createClient>

export type ClusterEngine = {
  server: WebSocketServer
  snapshot: () => unknown
  stop: () => void
}
export type ClusterBackend = {
  recent: { has: (a: string, b: string) => Promise<boolean>; remember: (a: string, b: string) => Promise<void> }
  saveInvitations: (value: unknown) => Promise<void>
  loadInvitations: () => Promise<unknown>
}

/** Redis owns coordinator election, epoch fencing, command/event streams and
 * TTL presence/cooldowns. Only one engine executes commands per epoch; any
 * replica may own a browser socket. Failover invalidates old sockets/rooms.
 * This intentionally preserves the existing two-phase matching implementation.
 * The coordinator is a capacity boundary: measure before raising launch limits.
 */
export async function createClusterGateway(factory: (backend: ClusterBackend) => Promise<ClusterEngine>) {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL required")
  const redis: Redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 3000) }, disableOfflineQueue: true })
  redis.on("error", () => { log.error("redis.disconnect"); if (initialized) retire() })
  let initialized = false
  redis.on("reconnecting", () => log.warn("redis.reconnect"))
  redis.on("ready", () => log.info("redis.connected"))
  await redis.connect()
  const instanceId = randomUUID()
  let epoch: string | null = null
  let ownedEpoch: string | null = null
  let retiredEpoch: string | null = null
  let engine: ClusterEngine | null = null
  let commandCursor = "0-0"
  let eventCursor = "0-0"
  let stopped = false
  let healthy = false
  let nextRenew = 0
  let leaseDeadline = 0
  let tickTimer: ReturnType<typeof setTimeout> | undefined
  let pendingOutputs = 0
  let pendingOutputBytes = 0
  const sockets = new Map<string, WebSocket>()
  const virtuals = new Map<string, VirtualSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false })

  async function command(args: string[]): Promise<unknown> {
    const start = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        redis.sendCommand(args),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("backend_timeout")), 3000); timer.unref() }),
      ])
    } finally {
      clearTimeout(timer)
      if (args[0] === "PING") log.info("metric.redis_latency", { durationMs: performance.now() - start })
    }
  }
  function disconnectAll() { for (const ws of sockets.values()) ws.close(1013, "service reconnecting"); sockets.clear() }
  function retire() {
    healthy = false
    const retiringEpoch = ownedEpoch
    ownedEpoch = null
    leaseDeadline = 0
    commandCursor = eventCursor = "0-0"
    if (retiringEpoch) {
      retiredEpoch = retiringEpoch
      log.warn("coordinator.lost", { generation: retiringEpoch })
      // Compare-and-delete cannot remove a successor's lease.
      if (redis.isReady) void command(["EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", "1", leaseKey, retiringEpoch]).catch(() => {})
    }
    for (const ws of virtuals.values()) ws.retire()
    virtuals.clear()
    engine?.stop()
    engine = null
    disconnectAll()
  }
  async function append(key: string, event: BusEvent) {
    const result = await command(["EVAL", appendFenced, "2", leaseKey, key, event.epoch, JSON.stringify(event)])
    if (!result) throw new Error("stale_epoch")
  }
  function output(event: BusEvent) {
    if (!ownedEpoch || event.epoch !== ownedEpoch || performance.now() >= leaseDeadline) { retire(); return }
    const size = Buffer.byteLength(event.data ?? "") + 256
    if (pendingOutputs >= 4096 || pendingOutputBytes + size > 16_000_000) { log.error("realtime.output_overload"); retire(); return }
    pendingOutputs++; pendingOutputBytes += size
    void append(outputKey, event).catch(() => { if (ownedEpoch === event.epoch) retire() }).finally(() => { pendingOutputs--; pendingOutputBytes -= size })
  }
  class VirtualSocket extends EventEmitter {
    readyState: number = WebSocket.OPEN
    constructor(readonly id: string, readonly generation: string) { super() }
    send(data: string) { if (this.readyState === WebSocket.OPEN && ownedEpoch === this.generation) output({ epoch: this.generation, id: this.id, op: "send", data }) }
    close(code = 1000) { output({ epoch: this.generation, id: this.id, op: "close", code }); this.retire() }
    terminate() { this.close(1013) }
    ping() { output({ epoch: this.generation, id: this.id, op: "ping" }) }
    retire() { if (this.readyState !== WebSocket.OPEN) return; this.readyState = WebSocket.CLOSED; this.emit("close") }
  }
  async function read(key: string, cursor: string): Promise<[string, BusEvent][]> {
    // A trimmed command could be a leave/block/report. Never silently continue
    // a partially observed generation. Reset rooms and require fresh tickets.
    if (cursor !== "0-0") {
      const first = await command(["XRANGE", key, "-", "+", "COUNT", "1"]) as [string, string[]][]
      const compare = (a: string, b: string) => {
        const aa = a.split("-").map(BigInt), bb = b.split("-").map(BigInt)
        return aa[0] > bb[0] || aa[0] === bb[0] && aa[1] > bb[1]
      }
      if (first.length && compare(first[0][0], cursor)) {
        log.error("realtime.stream_gap")
        // Followers also invalidate the shared generation on an output gap.
        if (epoch) await command(["EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", "1", leaseKey, epoch])
        throw new Error("stream_gap")
      }
    }
    const rows = await command(["XREAD", "COUNT", "1000", "STREAMS", key, cursor]) as [string, [string, string[]][]][] | null
    const entries = rows?.[0]?.[1] ?? []
    if (entries.length) log.info("realtime.stream_lag", { durationMs: Math.max(0, Date.now() - Number(entries[0][0].split("-")[0])), source: key === inputKey ? "commands" : "events", count: entries.length })
    return entries.map(([id, fields]) => [id, JSON.parse(fields[1]) as BusEvent])
  }
  const backend: ClusterBackend = {
    recent: {
      has: async (a,b) => Boolean(await command(["EXISTS", `${prefix}recent:${createHash("sha256").update(JSON.stringify([a,b].sort())).digest("hex")}`])),
      remember: async (a,b) => { await command(["SET", `${prefix}recent:${createHash("sha256").update(JSON.stringify([a,b].sort())).digest("hex")}`, "1", "PX", "600000"]) },
    },
    saveInvitations: async (value) => {
      const result = await command(["EVAL", "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[2],'PX',65000) return 1", "2", leaseKey, `${prefix}invitations`, ownedEpoch ?? "", JSON.stringify(value)])
      if (!result) throw new Error("stale_epoch")
    },
    loadInvitations: async () => { const raw = await command(["GET", `${prefix}invitations`]); return raw ? JSON.parse(String(raw)) : [] },
  }
  async function tick() {
    if (stopped) return
    try {
      if (ownedEpoch && performance.now() >= leaseDeadline) retire()
      if (Date.now() >= nextRenew) {
        nextRenew = Date.now() + RENEW_MS
        if (ownedEpoch) {
          const began = performance.now()
          if (!await command(["EVAL", renewFenced, "1", leaseKey, ownedEpoch, String(LEASE_MS)])) retire()
          else leaseDeadline = began + LEASE_MS - 1000
        }
        const current = await command(["GET", leaseKey]) as string | null
        if (current && current === retiredEpoch) {
          await command(["EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", "1", leaseKey, retiredEpoch])
          epoch = null; healthy = false; nextRenew = 0; return
        }
        if (epoch && current !== epoch) retire()
        epoch = current
        if (!current) {
          const candidate = `${instanceId}:${randomUUID()}`
          const began = performance.now()
          if (await command(["SET", leaseKey, candidate, "NX", "PX", String(LEASE_MS)])) {
            epoch = ownedEpoch = candidate
            leaseDeadline = began + LEASE_MS - 1000
            commandCursor = "0-0"
            const created = await factory(backend)
            if (ownedEpoch !== candidate || performance.now() >= leaseDeadline) { created.stop(); retire(); return }
            engine = created
            log.info("coordinator.acquired", { generation: candidate })
          }
        }
        healthy = Boolean(epoch) && redis.isReady
        await command(["PING"])
        log.info("realtime.gateway", { count: sockets.size, pendingOutputs, coordinator: Boolean(ownedEpoch), memoryBytes: process.memoryUsage().rss })
        if (ownedEpoch && engine) {
          await command(["SET", `${prefix}state`, JSON.stringify({ epoch, instanceId, ...engine.snapshot() as object }), "PX", String(LEASE_MS)])
        }
        await command(["SET", `${prefix}instance:${instanceId}`, JSON.stringify({ connections: sockets.size, epoch }), "PX", String(LEASE_MS)])
      }
      if (ownedEpoch && engine) {
        for (const [cursor, event] of await read(inputKey, commandCursor)) {
          commandCursor = cursor
          if (event.epoch !== ownedEpoch) continue
          if (performance.now() >= leaseDeadline || await command(["GET", leaseKey]) !== ownedEpoch) { retire(); return }
          if (event.op === "open") {
            if (virtuals.has(event.id)) continue
            const ws = new VirtualSocket(event.id, ownedEpoch)
            virtuals.set(event.id, ws)
            engine.server.emit("connection", ws)
          } else {
            const ws = virtuals.get(event.id)
            if (!ws) continue
            if (event.op === "message") ws.emit("message", Buffer.from(event.data ?? ""), false)
            if (event.op === "pong") ws.emit("pong")
            if (event.op === "close") { ws.retire(); virtuals.delete(event.id) }
          }
        }
      }
      if (epoch && await command(["GET", leaseKey]) !== epoch) { retire(); epoch = null; return }
      for (const [cursor, event] of await read(outputKey, eventCursor)) {
        eventCursor = cursor
        if (event.epoch !== epoch) continue
        const ws = sockets.get(event.id)
        if (!ws || ws.readyState !== WebSocket.OPEN) continue
        if (ws.bufferedAmount > MAX_WS_PAYLOAD * 2) { ws.close(1013, "slow connection"); continue }
        if (event.op === "send") ws.send(event.data ?? "")
        if (event.op === "ping") ws.ping()
        if (event.op === "close") ws.close(event.code ?? 1000)
      }
    } catch { retire(); epoch = null }
    finally { if (!stopped) tickTimer = setTimeout(() => void tick(), 25).unref() }
  }
  wss.on("connection", (ws) => {
    if (!healthy || !epoch) { ws.close(1013, "service unavailable"); return }
    const id = `${instanceId}:${randomUUID()}`
    const generation = epoch
    sockets.set(id, ws)
    log.info("ws.connected", { count: sockets.size })
    let authenticatedFrame = false
    let count = 0, windowStart = Date.now(), queued = 0
    let chain = append(inputKey, { epoch: generation, id, op: "open" }).catch(() => ws.close(1013, "service unavailable"))
    const enqueue = (event: BusEvent) => {
      if (stopped) return
      if (++queued > 100) { ws.close(1008, "rate limit"); return }
      chain = chain.then(() => append(inputKey, event)).catch(() => ws.close(1013, "service unavailable")).finally(() => queued--)
    }
    const deadline = setTimeout(() => { if (!authenticatedFrame) ws.close(1008, "hello required") }, 10_000)
    deadline.unref()
    ws.on("message", (data: RawData, binary) => {
      if (binary) { ws.close(1003, "text required"); return }
      if (Date.now() - windowStart > 10_000) { windowStart = Date.now(); count = 0 }
      if (++count > 200) { ws.close(1008, "rate limit"); return }
      const raw = data.toString()
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return }
      if (!isClientMessage(parsed)) return
      if (!authenticatedFrame) {
        if (parsed.type !== "hello" || !verifyTicket(parsed.ticket)) { ws.close(1008, "invalid ticket"); return }
        authenticatedFrame = true
        log.info("ws.ticket_valid", { count: 1 })
      }
      enqueue({ epoch: generation, id, op: "message", data: raw })
    })
    ws.on("pong", () => enqueue({ epoch: generation, id, op: "pong" }))
    ws.on("close", () => { clearTimeout(deadline); sockets.delete(id); log.info("ws.disconnected", { count: sockets.size }); enqueue({ epoch: generation, id, op: "close" }) })
    ws.on("error", () => {})
  })
  initialized = true
  await tick()
  return {
    server: wss,
    ready: () => healthy && redis.isReady,
    async close() {
      stopped = true; clearTimeout(tickTimer); retire()
      if (redis.isReady) await redis.quit().catch(() => {})
      else if (redis.isOpen) redis.destroy()
      wss.close()
    },
  }
}
