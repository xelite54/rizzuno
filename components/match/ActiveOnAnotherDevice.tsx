"use client"

type ActiveOnAnotherDeviceProps = {
  onRetry: () => void
}

/**
 * Shown instead of the normal home/matching screen once this device's
 * realtime connection has confirmed a genuinely different, still-active
 * device/tab already owns this account right now (an OmeTV-style
 * single-active-session policy — see hooks/useSignalingSocket.ts's
 * `supersededElsewhere` for the actual ownership check). Deliberately NOT
 * an error: nothing is broken, and the other session is completely
 * unaffected by this one existing — this is purely informational, the
 * same honest, low-drama tone LegalStatusError/AccountRestricted already
 * use for "matching doesn't proceed here, and here's plainly why."
 *
 * `onRetry` starts one fresh, real attempt (not a blind auto-retry loop —
 * see retryNow's own doc comment) for exactly the case this is actually
 * useful for: the other device has since gone idle or closed, and this
 * one can now safely become the active session instead.
 */
export function ActiveOnAnotherDevice({ onRetry }: ActiveOnAnotherDeviceProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 text-center sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Active on another device</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Rizzuno is already open and in use somewhere else on this account. Close it there, or come back to this
          device once you&apos;re done.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-xl border border-border text-[13px] font-medium text-foreground transition hover:bg-surface-2"
        >
          Try this device now
        </button>
      </div>
    </div>
  )
}
