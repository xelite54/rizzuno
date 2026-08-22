import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import next from "next"
import { createRizzunoWebSocketServer } from "./server/ws-server"
import { WS_PATH } from "./lib/signaling/protocol"
import { closeDb } from "./lib/db"

const port = Number(process.env.PORT) || 3000
const dev = process.env.NODE_ENV !== "production"

// Rejects a WebSocket upgrade whose Origin isn't one we recognize — a bare
// upgrade path with no auth of its own (identity comes later, from the
// "hello" ticket) is otherwise a plausible cross-site WebSocket hijacking
// target: an attacker's page could open a WS connection to this server
// using a victim's browser/cookies. Configurable via ALLOWED_WS_ORIGINS
// (comma-separated) — required in production, where the frontend (Vercel)
// and this realtime service (Railway) are different hosts, so same-origin
// can't be inferred from the request itself.
function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return dev // browsers always send Origin on a WS upgrade; only tolerate its absence (e.g. a non-browser dev tool) outside production
  const configured = process.env.ALLOWED_WS_ORIGINS
  if (configured) {
    const allowed = configured.split(",").map((entry) => entry.trim()).filter(Boolean)
    return allowed.includes(origin)
  }
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

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
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
    return
  }
  handle(req, res)
})

const wss = createRizzunoWebSocketServer()

httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname
  if (pathname !== WS_PATH) {
    // Not ours — Next's own upgrade handler (registered above via the
    // `httpServer` option) gets its own turn at the same event and handles
    // whatever this actually is.
    return
  }
  if (!isAllowedOrigin(req)) {
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

app.prepare().then(() => {
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Rizzuno ready on 0.0.0.0:${port}`)
  })
})

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
