"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { WS_PATH } from "@/lib/signaling/protocol"
import type { ClientMessage, ServerMessage } from "@/lib/signaling/protocol"
import { shouldReconnectAfterClose } from "@/lib/realtimeLifecycle"

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
/**
 * @param enabled Whether the transport should exist at all. Authentication
 * owns the realtime lifecycle (see hooks/useMatchmaking.ts and
 * MatchStage.tsx) — this used to connect unconditionally the instant the
 * component mounted, regardless of whether the guest was even signed in
 * yet, which is how a not-fully-onboarded account's ticket request could
 * come back `acceptance_required` and get misread as an account
 * restriction (see AccountRestricted.tsx) instead of just... not having
 * connected yet. `false` here means no WebSocket exists at all — not
 * "connected but not sending anything" — and if one was already open, this
 * effect's own cleanup (below) closes it and cancels any pending retry the
 * instant `enabled` flips.
 */
export function useSignalingSocket(enabled: boolean, accountId?: string) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef(new Set<Listener>())

  // Lifecycle-reason bookkeeping for the dev logs below only — never holds
  // or logs the actual accountId, just whether it changed.
  //
  // `prevStartDepsRef` is read/written entirely within the effect's own
  // setup phase (see "effect started" below), so it just needs to remember
  // what the deps were the last time this effect started.
  //
  // `latestDepsRef` is mirrored from props every render via a layout
  // effect (refs must never be written during render itself — see
  // react-hooks/refs), which runs before this hook's own passive
  // `useEffect` cleanup/setup in the same commit. That ordering is exactly
  // what makes it useful for CLEANUP specifically: a cleanup closure still
  // holds the enabled/accountId values from whenever ITS effect instance
  // was set up, but by the time cleanup actually runs, the layout effect
  // for whichever render triggered it has already run. If that render
  // changed enabled or accountId, `latestDepsRef.current` already reflects
  // the new value and the diff below names exactly which one changed. If
  // cleanup is instead running because the component is genuinely
  // unmounting, there was no further render at all — `latestDepsRef.current`
  // still equals the closed-over values exactly, and the diff falls
  // through to "unmounted".
  const prevStartDepsRef = useRef<{ enabled: boolean; accountId?: string } | null>(null)
  const latestDepsRef = useRef({ enabled, accountId })
  useLayoutEffect(() => {
    latestDepsRef.current = { enabled, accountId }
  })

  useEffect(() => {
    const prevStart = prevStartDepsRef.current
    const startReason = !prevStart
      ? "initial_mount"
      : prevStart.enabled !== enabled
        ? "enabled_changed"
        : "account_changed"
    prevStartDepsRef.current = { enabled, accountId }
    console.debug("signaling: effect started", { reason: startReason, enabled, hasAccount: Boolean(accountId) })

    if (!enabled) {
      // Nothing to do if we were never connected in the first place (e.g.
      // signed out from the start). If we WERE connected, `enabled` just
      // flipped from true to false, which means THIS effect run is really
      // just standing in for the previous run's cleanup path below — React
      // already ran that cleanup (closing the socket, cancelling the retry
      // timer) before ever reaching this line, since dependency changes
      // always tear down the prior effect first.
      return
    }
    let cancelled = false
    let retryDelay = 500
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    // Purely a log-correlation label — one physical socket attempt per
    // increment. The actual "is this callback about a socket we've since
    // moved on from" guard is (and remains) the `wsRef.current !==
    // currentSocket` identity check on each handler below; this just makes
    // that sequence legible in the logs without ever printing account/
    // ticket/credential data.
    let generation = 0

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
      generation += 1
      const thisGeneration = generation
      console.debug("signaling: socket created", { generation: thisGeneration })
      socket = new WebSocket(url)
      wsRef.current = socket
      const currentSocket = socket

      socket.onopen = () => {
        if (cancelled || wsRef.current !== currentSocket) return
        // Transport-connected only — NOT the same as "the realtime server
        // has processed our hello and is ready for 'find'" (see
        // useMatchmaking.ts's `realtimeReady`, which waits for the server's
        // own "ready" ack instead of inferring readiness from this). Nothing
        // is flushed/replayed here on purpose — see the module doc comment
        // above; useMatchmaking.ts reacts to `connected` itself and sends a
        // fresh "hello" from scratch instead.
        console.debug("signaling: socket opened", { generation: thisGeneration })
        retryDelay = 500
        setConnected(true)
      }

      socket.onmessage = (event) => {
        if (cancelled || wsRef.current !== currentSocket) return
        try {
          const message = JSON.parse(event.data) as ServerMessage
          listenersRef.current.forEach((listener) => listener(message))
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = (event) => {
        if (cancelled || wsRef.current !== currentSocket) return
        // The server closes with this specific code (see
        // server/ws-server.ts's hello handler + WS_CLOSE_SUPERSEDED's own
        // doc comment) exactly when another, already-healthy connection
        // for this same account exists elsewhere — a second tab/device, or
        // a reconnect that arrived while the previous socket here hadn't
        // actually died yet. That is NOT a transient network failure, and
        // must not be treated like one: reconnecting would just walk
        // straight back into the same ownership check and lose again,
        // which — before this check existed — is exactly what produced an
        // infinite replace/reconnect fight between two sockets for one
        // account (each side's blind "any close retries" logic kept
        // re-triggering the other's own supersession). This socket simply
        // stops here; a future genuine reason to reconnect (sign-out and
        // back in, an account switch, this tab reloading) starts a whole
        // new effect instance with its own fresh retry budget, not this one.
        const willReconnect = shouldReconnectAfterClose(event.code)
        console.debug("signaling: socket closed", {
          generation: thisGeneration,
          reason: willReconnect ? "network_close" : "superseded",
          code: event.code,
          wasClean: event.wasClean,
          willRetry: willReconnect,
        })
        setConnected(false)
        if (!willReconnect) return
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 1.6, 8000)
      }

      socket.onerror = () => {
        currentSocket.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      const latest = latestDepsRef.current
      const cleanupReason =
        latest.enabled !== enabled ? "enabled_changed" : latest.accountId !== accountId ? "account_changed" : "unmounted"
      console.debug("signaling: effect cleanup", { reason: cleanupReason })
      if (wsRef.current === socket) wsRef.current = null
      setConnected(false)
      socket?.close()
    }
  }, [enabled, accountId])

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
