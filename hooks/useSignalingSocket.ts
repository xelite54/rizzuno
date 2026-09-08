"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { WS_PATH } from "@/lib/signaling/protocol"
import type { ClientMessage, ServerMessage } from "@/lib/signaling/protocol"
import { shouldReconnectAfterClose, nextSupersededRetryDelayMs } from "@/lib/realtimeLifecycle"

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
// How long `enabled`/`accountId` have to hold STILL at "off" (disabled, or
// no account) before the connection effect below actually reacts to it —
// see the debounce effect's own doc comment just below for the full
// reasoning. Comfortably longer than the ~2s reconnect cadence Railway
// showed for a genuinely flapping account, so a real instance of that
// flapping (wherever it's ultimately coming from upstream) can never
// actually reach the socket-owning effect at all.
const DISABLE_DEBOUNCE_MS = 3000

export function useSignalingSocket(enabled: boolean, accountId?: string) {
  // `enabled`/`accountId` as this hook ACTUALLY reacts to them — everything
  // below (the connection-owning effect, its own start/cleanup-reason
  // logs) is keyed on these, never the raw props directly. This exists
  // because a real, confirmed production case (see the audit that added
  // the diagnostics further down) can make the RAW `enabled`/`accountId`
  // flap rapidly for reasons still being traced upstream (legal status,
  // profile hydration, or the account id itself briefly reporting
  // undefined) — and reacting to every single flap is exactly what tears
  // down and recreates an otherwise perfectly healthy socket over and
  // over. Turning ON (a real sign-in, finishing onboarding, a genuine
  // account switch landing on a real account) is never delayed — nothing
  // about starting a session should feel sluggish. Turning OFF is what
  // gets debounced, and only that direction, because it's the only one
  // that can tear down a healthy connection: if it flips back on before
  // DISABLE_DEBOUNCE_MS elapses, the effect's own cleanup below cancels
  // the pending timer automatically (the dependency changing tears down
  // and restarts this effect, same as any other effect), and the "off"
  // never actually reaches the socket at all. A genuine, LASTING sign-out
  // or account loss still takes effect, just delayed by at most this much.
  const [stable, setStable] = useState({ enabled, accountId })
  useEffect(() => {
    const isOn = enabled && Boolean(accountId)
    if (isOn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to enabled/accountId actually turning on, applied immediately and deliberately (see this effect's own doc comment) — not mirroring unrelated state
      setStable({ enabled, accountId })
      return
    }
    console.debug("signaling: enabled/accountId turned off — debouncing before acting on it", {
      willApplyInMs: DISABLE_DEBOUNCE_MS,
    })
    const timer = setTimeout(() => setStable({ enabled, accountId }), DISABLE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, accountId])
  const stableEnabled = stable.enabled
  const stableAccountId = stable.accountId

  // A random, opaque label for THIS hook instance (i.e. this browser
  // tab's lifetime) — never derived from account/session identity, purely
  // for correlating console lines across MULTIPLE effect instances (every
  // enabled/accountId change tears down and re-creates the effect below,
  // which would otherwise make each one's own local `generation` counter
  // restart from zero, silently hiding a remount-driven reconnect storm
  // from the very mechanism meant to reveal it). `useState`'s lazy
  // initializer (called exactly once, ever) is what makes this safe to
  // generate here rather than a plain `useRef(Math.random())`, which would
  // call the impure Math.random() on every single render even though only
  // the first result is ever kept.
  const [tabId] = useState(() => Math.random().toString(36).slice(2, 10))
  // How many sockets THIS hook instance has ever created — a ref, not a
  // local variable inside the effect below, specifically so it survives
  // every effect remount (see tabId's own comment) instead of resetting
  // to 0 each time. A generation count that climbs across what SHOULD have
  // been one continuous connection is itself direct proof of a
  // remount-driven duplicate-socket source, distinguishable in the logs
  // from a genuinely fresh tab (which starts at 1 and rarely climbs).
  const generationRef = useRef(0)
  const [connected, setConnected] = useState(false)
  // True once a superseded close has exhausted its one bounded retry (see
  // nextSupersededRetryDelayMs) — at that point this is confident a
  // genuinely different, still-active connection for this account exists
  // elsewhere (an OmeTV-style single-active-session policy), not just this
  // device's own stale connection racing its replacement. Exposed so the
  // UI can show a clean, honest "active on another device" state instead
  // of a frozen/disconnected-looking screen with no explanation — never
  // true for an ordinary network close, which keeps reconnecting normally
  // and never touches this at all.
  const [supersededElsewhere, setSupersededElsewhere] = useState(false)
  // Set inside the effect below to whatever its own `connect()` currently
  // is — lets `retryNow()` (a stable, always-safe-to-call function this
  // hook returns) trigger a real, fresh attempt through that SAME
  // connect(), without needing connect() itself to be a dependency
  // anywhere. A no-op whenever nothing is listening (enabled is false, or
  // between effect instances) — retryNow() is meant for "the person
  // tapped a retry action while this was showing supersededElsewhere",
  // not a general-purpose external trigger.
  const manualRetryRef = useRef<(() => void) | null>(null)
  const retryNow = useCallback(() => {
    manualRetryRef.current?.()
  }, [])
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
  const latestDepsRef = useRef({ enabled: stableEnabled, accountId: stableAccountId })
  useLayoutEffect(() => {
    latestDepsRef.current = { enabled: stableEnabled, accountId: stableAccountId }
  })

  useEffect(() => {
    const prevStart = prevStartDepsRef.current
    const startReason = !prevStart
      ? "initial_mount"
      : prevStart.enabled !== stableEnabled
        ? "enabled_changed"
        : "account_changed"
    prevStartDepsRef.current = { enabled: stableEnabled, accountId: stableAccountId }
    console.debug("signaling: effect started", {
      tabId,
      reason: startReason,
      enabled: stableEnabled,
      hasAccount: Boolean(stableAccountId),
      priorGenerationCount: generationRef.current,
    })

    if (!stableEnabled) {
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
    // How many of THIS effect instance's superseded closes have already
    // retried — see nextSupersededRetryDelayMs's own doc comment.
    let supersededRetriesUsed = 0

    // The one and only place a new WebSocket is ever constructed. `reason`
    // is never inferred after the fact — every call site below names
    // exactly why IT thinks a reconnect is warranted (initial_mount/
    // enabled_changed/account_changed from the effect starting,
    // backoff_retry, superseded_retry, visibility_resume, manual_retry),
    // so "signaling: socket created" always says which of those five
    // sources actually fired — no guessing from log ordering alone.
    //
    // The guard right below the log line is the actual structural
    // guarantee behind "a reconnect must never start while the current
    // socket is OPEN/CONNECTING, and exactly one live WebSocket exists per
    // tab/account": every call site (including the ones that already had
    // their own pre-check, like the visibility handler) still funnels
    // through this one shared check, so a bug/omission at any individual
    // call site can never actually produce a second live socket — this is
    // the last line of defense, not the only one.
    function connect(reason: string) {
      if (cancelled) return
      // Cancel any pending retry unconditionally, regardless of which of
      // the paths below is calling — a new connection attempt starting
      // makes whatever the old one was waiting to retry moot, and leaving
      // it armed is exactly how two independent timers could each end up
      // calling connect() a moment apart.
      clearTimeout(retryTimer)
      const existing = wsRef.current
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        console.warn("signaling: reconnect skipped — a socket is already OPEN/CONNECTING", {
          tabId,
          generation: generationRef.current,
          reason,
          existingReadyState: existing.readyState,
        })
        return
      }
      // A genuinely new attempt starting — whatever "active on another
      // device" state a previous attempt's exhausted retry budget left
      // showing no longer describes what's happening right now.
      setSupersededElsewhere(false)
      // Same-origin by default (the current single-process deployment —
      // server.ts serves both Next.js and the WebSocket on one host). If
      // the realtime server is ever deployed separately from the frontend
      // (see README's infrastructure notes), NEXT_PUBLIC_WS_URL points the
      // browser at that other host instead — no other code has to change.
      const configuredUrl = process.env.NEXT_PUBLIC_WS_URL
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const url = configuredUrl ? normalizeWsUrl(configuredUrl) : `${protocol}://${window.location.host}${WS_PATH}`
      generationRef.current += 1
      const thisGeneration = generationRef.current
      console.debug("signaling: socket created", { tabId, generation: thisGeneration, reason })
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
        console.debug("signaling: socket opened", { tabId, generation: thisGeneration })
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
        // actually died yet. That is NOT an ordinary transient network
        // failure, and must not be retried the same fast way one is —
        // blindly retrying at the normal backoff cadence is exactly what
        // used to produce an infinite replace/reconnect fight between two
        // sockets that are BOTH actually still active. But "superseded"
        // doesn't only mean a genuine second device: it's also exactly
        // what a device's own reconnect gets back when ITS OWN previous
        // connection died silently (mobile backgrounding/a network drop)
        // but still looks healthy to the server for a while (see
        // MAX_SUPERSEDED_RETRIES's own doc comment above) — treating every
        // superseded close as permanent left that case stuck on a dead
        // connection until a manual reload, even once the real owner (this
        // same device's stale old connection) was long gone.
        const willReconnectNormally = shouldReconnectAfterClose(event.code)
        const supersededRetryDelay = willReconnectNormally ? null : nextSupersededRetryDelayMs(supersededRetriesUsed)
        console.debug("signaling: socket closed", {
          tabId,
          generation: thisGeneration,
          reason: willReconnectNormally ? "network_close" : "superseded",
          code: event.code,
          wasClean: event.wasClean,
          willRetry: willReconnectNormally || supersededRetryDelay !== null,
        })
        setConnected(false)
        if (willReconnectNormally) {
          retryTimer = setTimeout(() => connect("backoff_retry"), retryDelay)
          retryDelay = Math.min(retryDelay * 1.6, 8000)
          return
        }
        if (supersededRetryDelay === null) {
          // The one bounded retry already happened and got superseded
          // again — this account genuinely has another active connection
          // elsewhere right now. Nothing left to do automatically; see
          // `retryNow` (returned by this hook) for the explicit,
          // person-initiated way out of this state.
          setSupersededElsewhere(true)
          return
        }
        supersededRetriesUsed += 1
        retryTimer = setTimeout(() => connect("superseded_retry"), supersededRetryDelay)
      }

      socket.onerror = () => {
        currentSocket.close()
      }
    }

    // Lets retryNow() (returned by this hook) trigger a real, fresh
    // attempt on demand — through this SAME connect(), with its own
    // bounded superseded-retry budget restored, not a second parallel
    // reconnect path. connect() itself is what actually guards against
    // firing while a socket is already OPEN/CONNECTING (see its own doc
    // comment) — this used to skip that guard entirely, the one call site
    // that could genuinely open a second live socket if it ever fired
    // while the existing one was still healthy. Cleared below on teardown
    // so a stale call afterward is a safe no-op instead of reaching into a
    // torn-down closure.
    manualRetryRef.current = () => {
      supersededRetriesUsed = 0
      connect("manual_retry")
    }

    connect(startReason)

    // Mobile OSes can silently kill a backgrounded tab's WebSocket with no
    // close event ever reaching JS until the tab is actually looked at
    // again — a screen lock, an extended app-switch, network suspension.
    // Left alone, that just means this waits out whatever backoff (up to
    // 8s) or superseded-retry (45s) delay was already ticking down while
    // nobody could see the result anyway. Reconnecting the instant the tab
    // is visible again — through this SAME connect(), never a second,
    // parallel one — is what makes "return to the app" feel immediate.
    // Does nothing if the transport already reports OPEN or is actively
    // CONNECTING; a socket that merely LOOKS open but is actually a
    // zombie connection is a real, if rare, browser-API limitation
    // (there's no client-exposed way to force-verify a WebSocket's live
    // state) — the existing per-action ack-timeouts (queue-pending, chat)
    // are what catch that if it ever actually matters, not a new,
    // additional verification timer layered on here too.
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return
      const current = wsRef.current
      if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return
      console.debug("signaling: tab visible again while disconnected — reconnecting now", { tabId })
      connect("visibility_resume")
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearTimeout(retryTimer)
      const latest = latestDepsRef.current
      const cleanupReason =
        latest.enabled !== stableEnabled ? "enabled_changed" : latest.accountId !== stableAccountId ? "account_changed" : "unmounted"
      console.debug("signaling: effect cleanup", { tabId, reason: cleanupReason })
      if (wsRef.current === socket) wsRef.current = null
      manualRetryRef.current = null
      setConnected(false)
      setSupersededElsewhere(false)
      socket?.close()
    }
    // `tabId` is genuinely constant for this hook instance's whole
    // lifetime (see its own useState lazy-initializer above) — included
    // here only to satisfy exhaustive-deps; it can never actually cause
    // this effect to re-run.
  }, [stableEnabled, stableAccountId, tabId])

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

  return { connected, send, subscribe, supersededElsewhere, retryNow }
}
