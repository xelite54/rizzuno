"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"

type PlusState = { active: boolean; loading: boolean; canManage: boolean; refresh: () => Promise<void>; requirePlus: (feature: string) => boolean }
const PlusContext = createContext<PlusState>({ active: false, loading: true, canManage: false, refresh: async () => {}, requirePlus: () => false })

export function RizzPlusProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const userId = session?.user?.id
  const router = useRouter()
  const [state, setState] = useState({ owner: "", active: false, loading: true, canManage: false })
  const refresh = useCallback(async () => {
    if (status !== "authenticated" || !userId) return
    try {
      const response = await fetch("/api/billing/status", { cache: "no-store" })
      if (!response.ok) throw new Error("billing_unavailable")
      const data = await response.json()
      setState({ owner: userId, active: data.active === true, canManage: data.canManage === true, loading: false })
    } catch { setState({ owner: userId, active: false, canManage: false, loading: false }) }
  }, [status, userId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh server-owned entitlement when the authenticated account changes
    void refresh()
    const visible = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", visible)
    const timer = setInterval(visible, 60_000)
    return () => { document.removeEventListener("visibilitychange", visible); clearInterval(timer) }
  }, [refresh])
  const active = !!userId && state.owner === userId && state.active
  const requirePlus = useCallback((feature: string) => {
    if (active) return true
    router.push(`/rizz-plus?feature=${encodeURIComponent(feature)}`)
    return false
  }, [active, router])
  return <PlusContext.Provider value={{ active, loading: status === "loading" || (status === "authenticated" && (state.owner !== userId || state.loading)), canManage: !!userId && state.owner === userId && state.canManage, refresh, requirePlus }}>{children}</PlusContext.Provider>
}

export const useRizzPlus = () => useContext(PlusContext)
