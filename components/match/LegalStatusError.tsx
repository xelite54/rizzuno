"use client"

type LegalStatusErrorProps = {
  onRetry: () => void
}

/**
 * Shown when checking legal-acceptance status itself failed (GET
 * /api/legal/status returned an error, or the request never made it) — not
 * the same thing as AgeGate, which is for the ordinary "you haven't
 * accepted the current Terms/Privacy yet" case (see AcceptanceStatus in
 * useLegalAcceptance.ts: "error" is a distinct state from "required" for
 * exactly this reason). Matching doesn't proceed either way, so this
 * doesn't weaken the 18+ gate — it's just honest that the reason nothing's
 * happening is a server problem, not a normal step in signing up.
 */
export function LegalStatusError({ onRetry }: LegalStatusErrorProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 text-center sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Couldn&apos;t check your account</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Something went wrong on our end. Your account wasn&apos;t affected — try again in a moment.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-xl border border-border text-[13px] font-medium text-foreground transition hover:bg-surface-2"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
