"use client"
import { useEffect, useState } from "react"
import { resolveRealtimeAccount } from "@/lib/realtimeLifecycle"

/** Loading is not logout. Confirmed logout/account changes still take effect immediately. */
export function useRealtimeAccount(current: string | undefined, status: string) {
  const [previous, setPrevious] = useState(current)
  const account = resolveRealtimeAccount(previous, current, status)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevious(account)
  }, [account])
  return account
}
