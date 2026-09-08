"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { resolveRealtimeAccount } from "@/lib/realtimeLifecycle"

/** Loading is not logout. Confirmed logout/account changes still take effect immediately. */
export function useRealtimeAccount(current: string | undefined, status: string) {
  const [previous, setPrevious] = useState(current)
  const account = resolveRealtimeAccount(previous, current, status)
  // Diagnostic only — logs a BOOLEAN change, never the account id itself.
  // Every consumer downstream (useSignalingSocket's `accountId`, and
  // useMatchmaking through it) tears down and recreates the realtime
  // connection whenever this hook's return VALUE changes — so if that's
  // happening on a cadence nobody asked for, this is the first place to
  // look: does `account` actually change value here on every render (this
  // fires), or is the instability introduced further downstream (this
  // stays quiet, and useSignalingSocket's own "effect started" log is the
  // one to check instead).
  const lastLoggedRef = useRef(account)
  // `status` is read via a ref, deliberately NOT added to this effect's own
  // dependency array — this hook's re-run cadence must stay exactly what
  // it was before this diagnostic existed (still keyed on `account` alone),
  // so instrumenting it can't itself add a new source of extra churn to
  // whatever's actually being investigated.
  const statusRef = useRef(status)
  useLayoutEffect(() => {
    statusRef.current = status
  })
  useEffect(() => {
    if (lastLoggedRef.current !== account) {
      console.debug("realtimeAccount: value changed", {
        status: statusRef.current,
        wasDefined: Boolean(lastLoggedRef.current),
        nowDefined: Boolean(account),
      })
      lastLoggedRef.current = account
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevious(account)
  }, [account])
  return account
}
