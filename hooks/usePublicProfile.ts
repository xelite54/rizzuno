"use client"

import { useEffect, useState } from "react"
import { fetchPublicProfile, type FetchedPublicProfile } from "@/lib/publicProfile"

/** Fresh server profile for another user, keyed by username. */
export function usePublicProfile(username?: string | null) {
  const [result, setResult] = useState<{ owner: string; profile?: FetchedPublicProfile; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!username) return
    let cancelled = false
    fetchPublicProfile(username)
      .then((profile) => { if (!cancelled) setResult({ owner: username, profile }) })
      .catch((error: Error) => { if (!cancelled) setResult({ owner: username, error: error.message }) })
    return () => { cancelled = true }
  }, [username, attempt])
  const current = username && result?.owner === username ? result : null
  return {
    profile: current?.profile ?? null,
    error: current?.error ?? null,
    loading: !!username && !current,
    retry: () => { setResult(null); setAttempt((value) => value + 1) },
  }
}
