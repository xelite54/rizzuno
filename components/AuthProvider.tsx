"use client"

import { SessionProvider } from "next-auth/react"

/**
 * Thin client boundary around Auth.js's SessionProvider — app/layout.tsx
 * stays a server component, this is the one bit of it that has to be a
 * client component so useSession() works anywhere below it.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
