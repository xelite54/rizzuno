"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { LegalNav } from "@/components/LegalNav"
import { GoogleIcon } from "@/components/icons"
import { BrandMark } from "./BrandMark"

type SignInLandingProps = {
  onSignIn: () => void
  /** Shown when Auth.js redirects back here after a cancelled or failed Google sign-in. */
  errorMessage?: string | null
}

/**
 * Shown on the match side before the guest signs in — nothing about the app
 * works yet until they do. This is also, functionally, Rizzuno's public
 * homepage: signed-out visitors (including a Google OAuth reviewer) land
 * here without needing to authenticate first, so it still carries the app
 * name and visible links to every legal page, not just the sign-in button —
 * the plain-language description that used to sit here was removed on
 * request; if Google's branding review starts flagging the homepage again
 * for lacking a description of what the app does, that's why.
 */
export function SignInLanding({ onSignIn, errorMessage }: SignInLandingProps) {
  const [eligible, setEligible] = useState(false)
  const [checked, setChecked] = useState(false)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void fetch("/api/eligibility", { cache: "no-store" }).then(response => response.json()).then(data => {
      setEligible(data.eligible === true); setChecked(true); setDenied(data.checked === true && data.eligible !== true)
    }).catch(() => setChecked(true))
  }, [])
  async function checkAge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setDenied(false)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/eligibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateOfBirth: form.get("dateOfBirth"), meetsHigherLocalAge: form.get("meetsHigherLocalAge") === "yes" }) })
      const data = await response.json()
      setEligible(response.ok && data.eligible === true); setDenied(!response.ok || data.eligible !== true)
    } catch { setDenied(true) } finally { setBusy(false) }
  }
  return (
    <div className="flex h-full w-full flex-col items-start justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="flex items-center gap-2">
        <BrandMark />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Rizzuno.com</span>
      </div>
      <h1 className="mt-3 text-[46px] font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-[56px]">
        Meet someone
        <br />
        new.
      </h1>
      {!eligible && checked && <form onSubmit={checkAge} className="mt-8 w-full space-y-3">
        <label className="block text-[13px] font-semibold text-foreground">Date of birth
          <input name="dateOfBirth" type="date" required autoComplete="bday" className="mt-1 h-12 w-full rounded-xl border border-border bg-background px-3 text-foreground" />
        </label>
        <label className="flex gap-2 text-[12px] leading-relaxed text-muted"><input name="meetsHigherLocalAge" value="yes" type="checkbox" required className="mt-1" /> I am at least 18 and meet any higher age of majority that applies where I live.</label>
        <button disabled={busy} className="h-12 w-full rounded-2xl bg-foreground font-semibold text-background disabled:opacity-50">{busy ? "Checking…" : "Check eligibility"}</button>
        <p className="text-[11px] leading-relaxed text-muted">Your date of birth is used only for this check and is not stored. The result, time, and gate version are kept briefly in a signed cookie. This is self-attestation, not government-ID or identity-level age verification.</p>
        {denied && <p role="alert" className="text-[13px] text-danger">Rizzuno is unavailable if you are under 18 or do not meet the applicable age of majority.</p>}
      </form>}
      {eligible && <button
        type="button"
        onClick={onSignIn}
        className="mt-8 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition hover:brightness-95 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>}
      {errorMessage && (
        <p className="mt-3 text-[13px] text-danger">{errorMessage}</p>
      )}

      <p className="mt-4 text-[12px] font-semibold text-foreground">18+ and applicable age of majority only</p>
      <p className="mt-3 text-[12px] text-muted">
        By continuing, you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>

      <LegalNav className="mt-3 text-[12px]" />
    </div>
  )
}
