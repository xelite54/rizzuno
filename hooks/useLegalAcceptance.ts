"use client"

import { useCallback, useEffect, useState } from "react"

export type AcceptanceStatus = "checking" | "required" | "accepted"

/**
 * Whether the signed-in account has affirmed 18+ and accepted the current
 * Terms/Privacy versions (see lib/legalVersions.ts + app/api/legal/*) —
 * gates matchmaking the same way username/gender onboarding does. Recorded
 * server-side against the authenticated account, not just a client-side
 * flag, so it can't be spoofed and survives a refresh.
 */
export function useLegalAcceptance(signedIn: boolean) {
  const [status, setStatus] = useState<AcceptanceStatus>("checking")

  useEffect(() => {
    if (!signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- signed out: nothing to check yet
      setStatus("checking")
      return
    }
    let cancelled = false
    fetch("/api/legal/status")
      .then((res) => (res.ok ? res.json() : { accepted: false }))
      .then((data: { accepted: boolean }) => {
        if (!cancelled) setStatus(data.accepted ? "accepted" : "required")
      })
      .catch(() => {
        if (!cancelled) setStatus("required")
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  const accept = useCallback(async () => {
    const res = await fetch("/api/legal/accept", { method: "POST" })
    if (res.ok) setStatus("accepted")
    return res.ok
  }, [])

  return { status, accept }
}
