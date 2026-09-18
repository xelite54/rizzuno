import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import next from "next"
import { createClusterGateway } from "./server/clusterGateway"
import { validateProductionConfig } from "./lib/productionConfig"
import { log } from "./lib/observability"
import { createRizzunoWebSocketServer, configureRealtimeCluster, realtimeSnapshot, resetRealtimeState } from "./server/ws-server"
import { WS_PATH } from "./lib/signaling/protocol"
import { closeDb, checkDatabaseReady, cleanupEphemeralRecords } from "./lib/db"

const port = Number(process.env.PORT) || 3000
const dev = process.env.NODE_ENV !== "production"

import { isAllowedWsOrigin } from "./lib/requestSecurity"

// Created before `next()` and handed to it via the `httpServer` option so
// Next.js registers its own upgrade handling (dev-mode HMR, etc.) directly
// on this same server, instead of only ever discovering it indirectly
// through a request's socket.
const httpServer = createServer()
const app = next({ dev, httpServer })
const handle = app.getRequestHandler()

httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  // Railway (and most PaaS health checks) expect a fast, unauthenticated
  // liveness endpoint. Deliberately shallow — it reports the process is
  // alive and accepting connections, not that Postgres is reachable, so a
  // brief database blip doesn't trip a restart loop on a process that's
  // otherwise fine. Real Postgres errors still surface per-request through
  // the routes/WS messages that actually need the database.
  if (req.url === "/ready") {
    void checkDatabaseReady().then(() => {
      const ready = process.env.NODE_ENV !== "production" || cluster?.ready()
      res.writeHead(ready ? 200 : 503, { "content-type": "text/plain", "cache-control": "no-store" }); res.end(ready ? "ready" : "unavailable")
    }).catch(() => { res.writeHead(503, { "content-type": "text/plain" }); res.end("unavailable") })
    return
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
    return
  }
  handle(req, res)
})

let cluster: Awaited<ReturnType<typeof createClusterGateway>> | undefined
let wss: ReturnType<typeof createRizzunoWebSocketServer>


httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname
  if (pathname !== WS_PATH) {
    // Not ours — Next's own upgrade handler (registered above via the
    // `httpServer` option) gets its own turn at the same event and handles
    // whatever this actually is.
    return
  }
  if (!wss) { socket.destroy(); return }
  if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
    socket.destroy()
    return
  }
  // Plain WS upgrade, same as any request this process receives — Railway
  // terminates TLS at its own edge proxy and forwards plain HTTP/WS to this
  // container, so the browser's wss:// connection arrives here as a normal
  // ws:// upgrade. There's nothing extra to configure for that on this end.
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req)
  })
})

app.prepare().then(async () => {
  validateProductionConfig("realtime")
  if (process.env.REDIS_URL) {
    cluster = await createClusterGateway(async (backend) => {
      resetRealtimeState()
      await configureRealtimeCluster(backend)
      const engine = createRizzunoWebSocketServer()
      return { server: engine, snapshot: realtimeSnapshot, stop: () => { engine.close(); resetRealtimeState() } }
    })
    wss = cluster.server
  } else {
    wss = createRizzunoWebSocketServer()
  }
  const cleanup = () => void cleanupEphemeralRecords().catch(() => log.error("retention.cleanup_failed"))
  cleanup()
  setInterval(cleanup, 3_600_000).unref()

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Rizzuno ready on 0.0.0.0:${port}`)
  })
}).catch(() => { log.error("startup.failed"); process.exit(1) })

// Graceful shutdown: Railway (and most container platforms) send SIGTERM
// before killing a deploy's old instance. Without handling it, in-flight
// requests/WS messages can be cut off mid-write and Postgres connections
// are left for the pool to eventually notice are dead rather than closed
// cleanly. A hard timeout guarantees this doesn't hang a deploy forever if
// something (a stuck request, a slow client) doesn't wind down in time.
let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`> Received ${signal}, shutting down gracefully…`)

  const forceExit = setTimeout(() => {
    console.log("> Graceful shutdown timed out, forcing exit")
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  for (const ws of wss.clients) {
    ws.close(1001, "server shutting down")
  }

  void cluster?.close()
  httpServer.close(() => {
    closeDb()
      .catch(() => {})
      .finally(() => {
        clearTimeout(forceExit)
        process.exit(0)
      })
  })
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

process.on("unhandledRejection", () => { log.error("process.unhandled_rejection"); shutdown("unhandledRejection") })
process.on("uncaughtException", () => { log.error("process.uncaught_exception"); shutdown("uncaughtException") })
