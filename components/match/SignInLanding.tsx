"use client"

import Link from "next/link"
import { GoogleIcon } from "@/components/icons"
import { BrandMark } from "./BrandMark"

type SignInLandingProps = {
  onSignIn: () => void
  /** Shown when Auth.js redirects back here after a cancelled or failed Google sign-in. */
  errorMessage?: string | null
}

/** Shown on the match side before the guest signs in — nothing about the app works yet until they do. */
export function SignInLanding({ onSignIn, errorMessage }: SignInLandingProps) {
  return (
    <div className="flex h-full w-full flex-col items-start justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="flex items-center gap-2">
        <BrandMark />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Rizzuno</span>
      </div>
      <h1 className="mt-3 text-[46px] font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-[56px]">
        Meet someone
        <br />
        new.
      </h1>
      <p className="mt-4 text-[14px] text-muted">Sign in to start matching.</p>

      <button
        type="button"
        onClick={onSignIn}
        className="mt-9 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition hover:brightness-95 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>
      {errorMessage && <p className="mt-3 text-[13px] text-danger">{errorMessage}</p>}

      <p className="mt-4 text-[12px] text-muted">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  )
}
