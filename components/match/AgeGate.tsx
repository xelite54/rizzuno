"use client"

import { useState } from "react"
import { useAgeEligibility } from "@/hooks/useAgeEligibility"

type AgeGateProps = {
  onAccept: () => Promise<boolean> | boolean
}

/**
 * Required right after signing in, before username/gender onboarding —
 * Rizzuno connects strangers over live video and is 18+ only. This is a
 * factual affirmation recorded against the signed-in account (see
 * app/api/legal/accept), not identity-level age verification — it doesn't
 * prove anyone's real age, and nothing here should be described as if it
 * does.
 */
export function AgeGate({ onAccept }: AgeGateProps) {
  const age = useAgeEligibility()
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  async function handleContinue() {
    if (!checked || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      if (!age.eligible && !await age.confirm()) return
      const ok = await onAccept()
      // Only a real failed request sets the error — never leftover state
      // from a previous attempt (cleared above before this one starts), and
      // never shown on success. On success this component unmounts almost
      // immediately anyway (the parent stops rendering AgeGate once
      // acceptance is recorded), so there's nothing further to reset here.
      if (!ok) setError(true)
    } catch {
      // onAccept() itself isn't expected to throw (see useLegalAcceptance's
      // own try/catch), but treating an unexpected throw as a real failure
      // — rather than leaving the button stuck on "Continuing…" forever —
      // is the safer default.
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Before you continue</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Rizzuno connects you with strangers over live video and is intended for adults only — at least 18, or the
          age of majority where you live if that&apos;s older.
        </p>

        <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left transition hover:border-foreground/25">
          <input
            type="checkbox"
            required
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-[13px] leading-relaxed text-foreground">
            I confirm I am 18 or older and meet applicable age requirements
          </span>
        </label>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">By selecting Continue, I accept the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </a>
            .
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">This is self-attestation, not verified age. Additional age checks apply in some locations.</p>
        {age.minimumAge > 18 && <p className="mt-2 text-xs text-muted">You must be at least {age.minimumAge} in your region.</p>}
        {age.provider && !age.eligible && <p className="mt-2 text-xs text-muted">Age check by {age.provider.name}. <a href={age.provider.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline">Provider privacy notice</a></p>}
        {age.unavailable && <p role="alert" className="mt-2 text-xs text-danger">The required age check is unavailable in your region.</p>}
        {age.error && <p role="alert" className="mt-2 text-xs text-danger">{age.error}</p>}

        {error && (
          <p className="mt-2 text-[12px] text-danger">Something went wrong — try again.</p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!checked || submitting || age.loading || age.busy || age.unavailable}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[14px] font-semibold text-background transition-all duration-200 hover:-translate-y-px hover:brightness-95 active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:pointer-events-none disabled:opacity-40"
        >
          {submitting ? "Continuing…" : "Continue"}
        </button>
      </div>
    </div>
  )
}
