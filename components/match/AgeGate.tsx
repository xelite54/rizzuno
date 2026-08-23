"use client"

import { useState } from "react"

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
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  async function handleContinue() {
    if (!checked || submitting) return
    setSubmitting(true)
    setError(false)
    const ok = await onAccept()
    if (!ok) {
      setError(true)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Before you continue</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Rizzuno connects you with strangers over live video and is intended for adults only — at least 18, or the
          age of majority where you live if that&apos;s older.
        </p>

        <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left transition hover:border-foreground/25">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-[13px] leading-relaxed text-foreground">
            I confirm I am at least 18 years old — or the age of majority where I live, if that&apos;s older — and I
            accept the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </a>
            .
          </span>
        </label>

        {error && (
          <p className="mt-2 text-[12px] text-danger">Something went wrong — try again.</p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!checked || submitting}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[14px] font-semibold text-background transition-all duration-200 hover:-translate-y-px hover:brightness-95 active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:pointer-events-none disabled:opacity-40"
        >
          {submitting ? "Continuing…" : "Continue"}
        </button>
      </div>
    </div>
  )
}
