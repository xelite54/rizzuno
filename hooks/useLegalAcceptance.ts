"use client"

import { useCallback, useEffect, useState } from "react"

// "error" is distinct from "required" on purpose: "required" means Rizzuno
// successfully checked and this account genuinely hasn't accepted the
// current versions yet (the normal first-time flow) — "error" means
// Rizzuno *couldn't check at all* (the status request itself failed, e.g.
// the database was unreachable). Collapsing the second case into the first
// used to be exactly how a real server failure quietly presented itself as
// an ordinary "please accept our terms" screen, with nothing indicating
// anything had actually gone wrong.
export type AcceptanceStatus = "checking" | "required" | "accepted" | "error"

/**
 * Whether the signed-in account has affirmed 18+ and accepted the current
 * Terms/Privacy versions (see lib/legalVersions.ts + app/api/legal/*) —
 * gates matchmaking the same way username/gender onboarding does. Recorded
 * server-side against the authenticated account, not just a client-side
 * flag, so it can't be spoofed and survives a refresh.
 *
 * @param revalidateSession Auth.js's own `useSession().update` — called
 * once if the status check comes back 401 despite `signedIn` being true.
 * That combination means the client's cached session state and the
 * server's actual session cookie have drifted apart (usually: it expired).
 * Forcing a real session refetch resolves that drift one way or the other:
 * if the server genuinely has no session, `signedIn` (owned by whoever
 * calls this hook, via its own `useSession()`) flips to `false` on the next
 * render, this hook's effect re-runs and does nothing further, and the
 * caller falls back to its sign-in screen — never this hook showing a
 * scary "couldn't check your account" for what's actually just an expired
 * session. If the session turns out to still be valid (a transient 401),
 * the status check is retried once with a fresh request.
 */
export function useLegalAcceptance(signedIn: boolean, revalidateSession: () => Promise<unknown>) {
  const [status, setStatus] = useState<AcceptanceStatus>("checking")
  // The real error code from a failed check — e.g. "database_error" or
  // "auth_error" from app/api/legal/status/route.ts's JSON body, or
  // "network_error" if the request never got a response at all. Reported
  // to the browser console and available to whatever renders the "error"
  // status, instead of every failure collapsing into one undifferentiated
  // "error" with no indication of which of several very different problems
  // actually happened.
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // Bumping this re-runs the status check below — the only way `retry()`
  // (returned for the "error" state's UI to call) actually retries anything.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- signed out: nothing to check yet
      setStatus("checking")
      return
    }
    let cancelled = false
    setStatus("checking")
    setErrorCode(null)

    async function check(alreadyRevalidated: boolean) {
      let res: Response
      try {
        res = await fetch("/api/legal/status")
      } catch {
        if (!cancelled) {
          setStatus("error")
          setErrorCode("network_error")
          console.error("legal/status: request failed (network_error)")
        }
        return
      }
      if (cancelled) return

      if (res.status === 401 && !alreadyRevalidated) {
        // signedIn is true (checked above) but the server says otherwise —
        // revalidate once before treating this as a real failure.
        await revalidateSession()
        if (!cancelled) await check(true)
        return
      }

      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        const code = body.error ?? `http_${res.status}`
        if (!cancelled) {
          setStatus("error")
          setErrorCode(code)
        }
        console.error("legal/status: request failed", { status: res.status, code })
        return
      }

      const data: { accepted: boolean } = await res.json()
      if (!cancelled) setStatus(data.accepted ? "accepted" : "required")
    }

    check(false)

    return () => {
      cancelled = true
    }
  }, [signedIn, attempt, revalidateSession])

  const accept = useCallback(async () => {
    try {
      const res = await fetch("/api/legal/accept", { method: "POST" })
      if (res.ok) setStatus("accepted")
      return res.ok
    } catch {
      // A network-level failure (fetch itself rejecting) is a real failure
      // too, not just a non-2xx response — without this, AgeGate's `await
      // onAccept()` would throw unhandled and the button would be stuck on
      // "Continuing…" forever with no error shown at all.
      return false
    }
  }, [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, errorCode, accept, retry }
}
