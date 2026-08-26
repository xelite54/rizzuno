"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { WS_PATH } from "@/lib/signaling/protocol"
import type { ClientMessage, ServerMessage } from "@/lib/signaling/protocol"

type Listener = (message: ServerMessage) => void

/**
 * Normalizes a configured NEXT_PUBLIC_WS_URL so it always lands on the
 * realtime server's actual WebSocket path. server.ts only ever accepts an
 * upgrade whose pathname is exactly WS_PATH ("/rizzuno-ws") — see its
 * `httpServer.on("upgrade", ...)` handler — but the natural value to copy
 * out of Railway's dashboard is a bare origin (e.g.
 * "wss://rizzuno-realtime.up.railway.app") with no path at all. Without
 * this, a bare-origin value would open a WebSocket connection to the right
 * host but the wrong path, which server.ts rejects outright (falls through
 * to Next's own upgrade handling, which doesn't recognize it either) — the
 * socket would just never open, indistinguishable from the host itself
 * being unreachable.
 *
 * Idempotent: a value that already ends in WS_PATH is left alone rather
 * than duplicated.
 */
function normalizeWsUrl(configuredUrl: string): string {
  try {
    const url = new URL(configuredUrl)
    url.pathname = WS_PATH
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    // Not a parseable absolute URL (e.g. a typo missing the wss:// scheme)
    // — fall back to plain string handling rather than throwing; a
    // malformed env var should degrade, not crash the whole app.
    const trimmed = configuredUrl.replace(/\/+$/, "")
    return trimmed.endsWith(WS_PATH) ? trimmed : `${trimmed}${WS_PATH}`
  }
}

/** Low-level WebSocket lifecycle: connect, auto-reconnect with backoff, queue sends while offline. */
export function useSignalingSocket() {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef(new Set<Listener>())
  const queueRef = useRef<ClientMessage[]>([])

  useEffect(() => {
    let cancelled = false
    let retryDelay = 500
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (cancelled) return
      // Same-origin by default (the current single-process deployment —
      // server.ts serves both Next.js and the WebSocket on one host). If
      // the realtime server is ever deployed separately from the frontend
      // (see README's infrastructure notes), NEXT_PUBLIC_WS_URL points the
      // browser at that other host instead — no other code has to change.
      const configuredUrl = process.env.NEXT_PUBLIC_WS_URL
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const url = configuredUrl ? normalizeWsUrl(configuredUrl) : `${protocol}://${window.location.host}${WS_PATH}`
      socket = new WebSocket(url)
      wsRef.current = socket

      socket.onopen = () => {
        // Transport-connected only — NOT the same as "the realtime server
        // has processed our hello and is ready for 'find'" (see
        // useMatchmaking.ts's `realtimeReady`, which waits for the server's
        // own "ready" ack instead of inferring readiness from this).
        console.log("signaling: transport connected")
        retryDelay = 500
        setConnected(true)
        const queued = queueRef.current
        queueRef.current = []
        queued.forEach((message) => socket?.send(JSON.stringify(message)))
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage
          listenersRef.current.forEach((listener) => listener(message))
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = () => {
        console.log("signaling: transport closed", { willRetryInMs: cancelled ? null : retryDelay })
        setConnected(false)
        if (cancelled) return
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 1.6, 8000)
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])

  const send = useCallback((message: ClientMessage) => {
    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    } else {
      queueRef.current.push(message)
    }
  }, [])

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  return { connected, send, subscribe }
}
