import { test } from "node:test"
import assert from "node:assert/strict"
import { fork, spawn } from "node:child_process"
import { createServer } from "node:net"
import { createClient } from "redis"
import { TestClient } from "../helpers/wsHarness.mts"
import { mintTicket } from "../../lib/realtimeTicket.ts"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
async function until(check: () => Promise<boolean>, ms = 25_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await check()) return; await pause(100) }
  throw new Error("cluster condition timeout")
}
test("two real processes: cross-gateway match, coordinator death, fencing and replacement", { timeout: 90_000 }, async () => {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0,"127.0.0.1",resolve))
  const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()))
  const redisProcess = spawn(process.env.REDIS_SERVER_BIN ?? "redis-server", ["--bind","127.0.0.1","--port",String(port),"--save","","--appendonly","no"], { stdio: "ignore" })
  let redisError: Error | undefined
  redisProcess.on("error", e => { redisError = e })
  const redis = createClient({ url: `redis://127.0.0.1:${port}`, socket: { reconnectStrategy: () => 100 } }); redis.on("error", () => {})
  const processes: ReturnType<typeof fork>[] = [], clients: TestClient[] = []
  try {
    await pause(200); if (redisError) throw redisError
    await redis.connect()
    process.env.REALTIME_TICKET_SECRET = "cluster-test-secret-not-for-production"
    async function start() {
      const child = fork("tests/helpers/clusterProcess.mts", { execArgv: ["--import","tsx","--experimental-test-module-mocks"], env: { ...process.env, NODE_ENV: "test", REDIS_URL: `redis://127.0.0.1:${port}` }, stdio: ["ignore","inherit","inherit","ipc"] }); processes.push(child)
      const childPort = await new Promise<number>((resolve,reject) => { const t=setTimeout(() => reject(new Error("child startup timeout")),10000); child.once("message", (message: { port: number }) => { clearTimeout(t); resolve(message.port) }); child.once("error",reject) })
      await until(async () => (await fetch(`http://127.0.0.1:${childPort}`)).ok)
      return { child, port: childPort }
    }
    const first = await start(), second = await start()
    const leaseKey = "rizzuno:{realtime}:lease"
    const original = await redis.get(leaseKey); assert.ok(original)
    async function hello(port: number, id: string, gender: "male" | "female") {
      const c = new TestClient(`ws://127.0.0.1:${port}/ws`); clients.push(c); await c.waitForOpen()
      c.send({ type: "hello", ticket: mintTicket(id), handle: id, gender, profilePhoto: null }); await c.waitForType("ready",5000); return c
    }
    console.log("cluster stage initial hello")
    const a = await hello(first.port,"cluster-a","male"), b = await hello(second.port,"cluster-b","female")
    a.send({ type: "find" }); b.send({ type: "find" })
    const [ma,mb] = await Promise.all([a.waitForType("matched",5000),b.waitForType("matched",5000)])
    assert.equal(ma.roomId,mb.roomId)
    // First process acquired before second was started. Abrupt death leaves lease
    // to expire; calls are expected to disconnect, not survive failover.
    console.log("cluster stage kill coordinator")
    first.child.kill("SIGKILL")
    await until(async () => { const next = await redis.get(leaseKey); return !!next && next !== original })
    await until(async () => b.ws.readyState === 3)
    const stale = await redis.eval("if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end return redis.call('XADD',KEYS[2],'*','payload','stale')", { keys:[leaseKey,"rizzuno:{realtime}:events"], arguments:[original!] })
    assert.equal(stale,0)
    console.log("cluster stage replacement hello")
    const c = await hello(second.port,"cluster-c","male"), d = await hello(second.port,"cluster-d","female")
    c.send({ type: "find" }); d.send({ type: "find" })
    const [mc,md] = await Promise.all([c.waitForType("matched",5000),d.waitForType("matched",5000)])
    assert.equal(mc.roomId,md.roomId); assert.notEqual(mc.roomId,ma.roomId)
    // Force a Redis disconnect without losing data, then require fresh sessions.
    await redis.sendCommand(["CLIENT","KILL","TYPE","normal","SKIPME","yes"])
    await until(async () => c.ws.readyState === 3)
    await until(async () => (await fetch(`http://127.0.0.1:${second.port}`)).ok)
    console.log("cluster stage redis reconnect hello")
    const e = await hello(second.port,"cluster-e","male"); assert.equal(e.ws.readyState,1)
  } finally {
    for (const c of clients) c.ws.terminate()
    for (const child of processes) child.kill("SIGTERM")
    if (redis.isOpen) redis.destroy()
    redisProcess.kill("SIGTERM")
  }
})
