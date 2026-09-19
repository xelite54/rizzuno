"use client"
import { useEffect } from "react"
import { removeStaleServiceWorker } from "@/lib/staleServiceWorker"
export function StaleServiceWorkerCleanup() {
  useEffect(() => { void removeStaleServiceWorker().catch(() => {}) }, [])
  return null
}
