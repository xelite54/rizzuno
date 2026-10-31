"use client"

import { useEffect, useState } from "react"

type Eligibility = { eligible: boolean; minimumAge: number; unavailable?: boolean; provider?: { name: string; privacyUrl: string } | null }
const initial: Eligibility = { eligible: false, minimumAge: 18 }
const messages: Record<string, string> = {
  confirmation_required: "Confirm that you meet the age requirements to continue.",
  region_unavailable: "Rizzuno is unavailable in your region.",
  age_assurance_unavailable: "The required age check is unavailable. Please try again later.",
  age_assurance_expired: "Your age check expired. Please start again.",
  age_assurance_denied: "The age check did not confirm eligibility. You cannot continue. Contact support if you believe this is an error.",
  age_assurance_pending: "Your age check is still processing. Select Continue to check again.",
  rate_limited: "Please wait a moment before trying again.",
}

function returningFromProvider() { return new URLSearchParams(window.location.search).get("ageAssurance") === "complete" }
function clearProviderReturn() {
  const url = new URL(window.location.href)
  url.searchParams.delete("ageAssurance")
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
}

export function useAgeEligibility() {
  const [eligibility, setEligibility] = useState<Eligibility>(initial)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Completion is same-origin POST; redirect/query content is never proof.
        if (returningFromProvider()) {
          const result = await fetch("/api/eligibility/assurance", { method: "POST" })
          const data = await result.json()
          if (!result.ok && !cancelled) setError(messages[data.error] ?? "Unable to complete the age check. Please try again.")
          if (result.ok || result.status === 403) clearProviderReturn()
        }
        const response = await fetch("/api/eligibility", { cache: "no-store" })
        if (!response.ok) throw new Error("status_failed")
        const data = await response.json()
        if (!cancelled) setEligibility({ ...initial, ...data, eligible: data.eligible === true })
      } catch { if (!cancelled) setError("Unable to check eligibility. Please try again.") }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function confirm() {
    if (busy) return false
    setBusy(true); setError(null)
    try {
      const completing = returningFromProvider()
      const response = await fetch(completing ? "/api/eligibility/assurance" : "/api/eligibility", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmedAdult: true }),
      })
      const data = await response.json()
      if (completing && (response.ok || response.status === 403)) clearProviderReturn()
      if (response.ok && data.assuranceRequired === true && typeof data.redirectUrl === "string") {
        window.location.assign(data.redirectUrl)
        return false
      }
      const eligible = response.ok && data.eligible === true
      setEligibility(current => ({ ...current, eligible }))
      if (!eligible) setError(messages[data.error] ?? "Unable to confirm eligibility. Please try again.")
      return eligible
    } catch { setError("Unable to confirm eligibility. Please try again."); return false }
    finally { setBusy(false) }
  }
  return { ...eligibility, loading, busy, error, confirm }
}
