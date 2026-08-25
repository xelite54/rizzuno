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
 */
export function useLegalAcceptance(signedIn: boolean) {
  const [status, setStatus] = useState<AcceptanceStatus>("checking")
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
    fetch("/api/legal/status")
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setStatus("error")
          return
        }
        const data: { accepted: boolean } = await res.json()
        setStatus(data.accepted ? "accepted" : "required")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, attempt])

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

  return { status, accept, retry }
}
