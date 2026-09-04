"use client"

import Link from "next/link"
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
      <button
        type="button"
        onClick={onSignIn}
        className="mt-8 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition hover:brightness-95 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>
      {errorMessage && (
        <p className="mt-3 text-[13px] text-danger">{errorMessage}</p>
      )}

      <p className="mt-4 text-[12px] font-semibold text-foreground">18+ only</p>
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

      <nav aria-label="Legal" className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>
        <Link href="/community-guidelines" className="underline underline-offset-2 hover:text-foreground">
          Community Guidelines
        </Link>
        <Link href="/safety" className="underline underline-offset-2 hover:text-foreground">
          Safety
        </Link>
      </nav>
    </div>
  )
}
