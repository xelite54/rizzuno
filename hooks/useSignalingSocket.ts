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

/**
 * Low-level WebSocket lifecycle: connect, auto-reconnect with backoff.
 *
 * Deliberately does NOT queue-and-replay `send()`s made while offline. An
 * earlier version did — any message sent while disconnected went into a
 * queue and was flushed the instant `onopen` fired. That was wrong: `onopen`
 * only means the *transport* reconnected, not that the server has verified
 * a fresh "hello" and sent "ready" back (see useMatchmaking.ts's
 * `realtimeReady`) — server/ws-server.ts silently ignores every non-"hello"
 * message until that ConnectionState exists. Flushing a queued
 * find/skip/leave/block/chat/signal/etc. straight into that gap meant it
 * was either silently dropped, or — worse — replayed against a brand-new
 * connection as if the old room/search/action it referred to still applied,
 * when server/ws-server.ts's own close handler had already torn all of that
 * down the moment the old socket disconnected.
 *
 * The fix is architectural, not a smarter queue: nothing sent while
 * offline is persisted here at all — it's just dropped (logged, not
 * thrown). "hello" is the one message that legitimately needs to go out
 * again after a reconnect, and useMatchmaking.ts already re-sends it itself
 * on every `connected` transition (not via this queue); "find" is
 * re-established the same way, from `wantsMatching`, once "ready" actually
 * comes back. Every other message type (skip/leave/block/chat/signal/...)
 * is inherently tied to a specific room/search that a disconnect has
 * already invalidated, so there is nothing correct to replay for it.
 */
export function useSignalingSocket() {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef(new Set<Listener>())

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
        // own "ready" ack instead of inferring readiness from this). Nothing
        // is flushed/replayed here on purpose — see the module doc comment
        // above; useMatchmaking.ts reacts to `connected` itself and sends a
        // fresh "hello" from scratch instead.
        console.log("signaling: transport connected")
        retryDelay = 500
        setConnected(true)
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
      return
    }
    // Dropped, not queued — see the module doc comment above for why. A
    // caller that genuinely needs this to survive a reconnect (hello, find)
    // already re-issues it itself once the connection is actually ready
    // again, rather than relying on this transport layer to remember it.
    console.warn("signaling: dropping message — socket not open", { type: message.type })
  }, [])

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  return { connected, send, subscribe }
}
