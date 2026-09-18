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
  const redis: Redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false }, disableOfflineQueue: true })
  redis.on("error", () => log.error("realtime.backend_unavailable"))
  await redis.connect()
  const instanceId = randomUUID()
  let epoch: string | null = null
  let ownedEpoch: string | null = null
  let engine: ClusterEngine | null = null
  let commandCursor = "0-0"
  let eventCursor = "0-0"
  let stopped = false
  let healthy = false
  let nextRenew = 0
  let pendingOutputs = 0
  const sockets = new Map<string, WebSocket>()
  const virtuals = new Map<string, VirtualSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false })

  async function command(args: string[]): Promise<unknown> {
    return await Promise.race([
      redis.sendCommand(args),
      new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error("backend_timeout")), 3000); t.unref() }),
    ])
  }
  function disconnectAll() { for (const ws of sockets.values()) ws.close(1013, "service reconnecting"); sockets.clear() }
  function retire() {
    healthy = false
    ownedEpoch = null
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
    if (pendingOutputs >= 500) { retire(); return }
    pendingOutputs++
    void append(outputKey, event).catch(() => retire()).finally(() => pendingOutputs--)
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
    const rows = await command(["XREAD", "COUNT", "100", "STREAMS", key, cursor]) as [string, [string, string[]][]][] | null
    return (rows?.[0]?.[1] ?? []).map(([id, fields]) => [id, JSON.parse(fields[1]) as BusEvent])
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
      if (Date.now() >= nextRenew) {
        nextRenew = Date.now() + RENEW_MS
        if (ownedEpoch) {
          if (!await command(["EVAL", renewFenced, "1", leaseKey, ownedEpoch, String(LEASE_MS)])) retire()
        }
        const current = await command(["GET", leaseKey]) as string | null
        if (epoch && current !== epoch) retire()
        epoch = current
        if (!current) {
          const candidate = `${instanceId}:${randomUUID()}`
          if (await command(["SET", leaseKey, candidate, "NX", "PX", String(LEASE_MS)])) {
            epoch = ownedEpoch = candidate
            commandCursor = "0-0"
            engine = await factory(backend)
          }
        }
        healthy = Boolean(epoch)
        if (ownedEpoch && engine) {
          await command(["SET", `${prefix}state`, JSON.stringify({ epoch, instanceId, ...engine.snapshot() as object }), "PX", String(LEASE_MS)])
        }
        await command(["SET", `${prefix}instance:${instanceId}`, JSON.stringify({ connections: sockets.size, epoch }), "PX", String(LEASE_MS)])
      }
      if (ownedEpoch && engine) {
        for (const [cursor, event] of await read(inputKey, commandCursor)) {
          commandCursor = cursor
          if (event.epoch !== ownedEpoch) continue
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
    finally { if (!stopped) setTimeout(() => void tick(), 25).unref() }
  }
  wss.on("connection", (ws) => {
    if (!healthy || !epoch) { ws.close(1013, "service unavailable"); return }
    const id = `${instanceId}:${randomUUID()}`
    const generation = epoch
    sockets.set(id, ws)
    let authenticatedFrame = false
    let count = 0, windowStart = Date.now(), queued = 0
    let chain = append(inputKey, { epoch: generation, id, op: "open" })
    const enqueue = (event: BusEvent) => {
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
      }
      enqueue({ epoch: generation, id, op: "message", data: raw })
    })
    ws.on("pong", () => enqueue({ epoch: generation, id, op: "pong" }))
    ws.on("close", () => { clearTimeout(deadline); sockets.delete(id); enqueue({ epoch: generation, id, op: "close" }) })
    ws.on("error", () => {})
  })
  await tick()
  return {
    server: wss,
    ready: () => healthy && redis.isReady,
    async close() { stopped = true; retire(); await redis.quit().catch(() => {}); wss.close() },
  }
}
