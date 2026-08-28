// IMPORTANT: this must be imported (for its side effect of calling
// mock.module()) BEFORE server/ws-server.ts or server/matchmaker.ts are
// ever imported anywhere in the process — both pull in lib/db.ts, which
// this replaces entirely so no test needs a live Postgres.
import "./dbMock.mts"

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocket } from "ws"
import { createRizzunoWebSocketServer } from "../../server/ws-server"
import { WS_PATH } from "../../lib/signaling/protocol"
import type { ClientMessage, ServerMessage } from "../../lib/signaling/protocol"
import { mintTicket } from "../../lib/realtimeTicket"

process.env.REALTIME_TICKET_SECRET ||= "test-secret-not-for-production"

/** Boots a real HTTP server + the real WebSocket server (server/ws-server.ts, unmodified) on an ephemeral port — mirrors server.ts's own upgrade wiring, minus the Origin check (that's server.ts's own concern, not ws-server.ts's, and irrelevant to what these tests exercise). */
export async function startTestServer() {
  const httpServer = createServer()
  const wss = createRizzunoWebSocketServer()

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname
    if (pathname !== WS_PATH) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req)
    })
  })

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const port = (httpServer.address() as AddressInfo).port

  return {
    url: `ws://127.0.0.1:${port}${WS_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate()
        httpServer.close(() => resolve())
      }),
  }
}

/** A thin, promise-based wrapper around a real `ws` client connection — buffers every received ServerMessage (so a test can assert on messages received before it started explicitly waiting) and exposes `waitFor` to pull the next one matching a predicate. */
export class TestClient {
  ws: WebSocket
  private received: ServerMessage[] = []
  private waiters: { predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage
      const waiterIndex = this.waiters.findIndex((w) => w.predicate(message))
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1)
        waiter.resolve(message)
      } else {
        this.received.push(message)
      }
    })
  }

  async waitForOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve())
      this.ws.once("error", reject)
    })
  }

  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message))
  }

  /** Resolves with the next (already-received-but-unclaimed, or future) message matching `predicate`. Times out loudly rather than hanging a test forever if the server never sends it. */
  waitFor(predicate: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const bufferedIndex = this.received.findIndex(predicate)
    if (bufferedIndex >= 0) {
      const [message] = this.received.splice(bufferedIndex, 1)
      return Promise.resolve(message)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === wrappedResolve)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const wrappedResolve = (m: ServerMessage) => {
        clearTimeout(timer)
        resolve(m)
      }
      this.waiters.push({ predicate, resolve: wrappedResolve })
    })
  }

  async waitForType<T extends ServerMessage["type"]>(type: T, timeoutMs = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    return (await this.waitFor((m) => m.type === type, timeoutMs)) as Extract<ServerMessage, { type: T }>
  }

  close() {
    this.ws.close()
  }
}

/** Connects, sends "hello" with a freshly minted, genuinely-signed ticket (never a bare client-declared id — same as the real client), and waits for "ready". Returns the connected client ready to drive the rest of a scenario. */
export async function connectAndHello(
  url: string,
  userId: string,
  options: { handle?: string; username?: string; gender?: "male" | "female"; profilePhoto?: string | null } = {}
): Promise<TestClient> {
  const client = new TestClient(url)
  await client.waitForOpen()
  client.send({
    type: "hello",
    ticket: mintTicket(userId),
    handle: options.handle ?? `handle-${userId}`,
    username: options.username,
    gender: options.gender,
    profilePhoto: options.profilePhoto ?? null,
  })
  await client.waitForType("ready")
  return client
}
