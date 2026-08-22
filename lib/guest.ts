"use client"

// A cosmetic fallback display name — shown only until a real username is
// chosen. Purely decorative: it carries no identity or security meaning
// (that's the authenticated Google account id now, see
// lib/realtimeTicket.ts), so generating and caching one client-side is
// fine. Cached per account (keyed by the authenticated user id) so it
// doesn't change on every reload.

const ADJECTIVES = [
  "Quiet", "Lunar", "Swift", "Golden", "Amber", "Neon", "Velvet", "Coral",
  "Midnight", "Electric", "Wandering", "Gentle", "Bright", "Hidden", "Bold",
] as const

const NOUNS = [
  "Otter", "Comet", "Fox", "Sparrow", "Wave", "Ember", "Lynx", "Willow",
  "Falcon", "Harbor", "Meadow", "Raven", "Aurora", "Cricket", "Maple",
] as const

function randomFrom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function generateHandle(): string {
  return `${randomFrom(ADJECTIVES)} ${randomFrom(NOUNS)}`
}

const STORAGE_PREFIX = "rizzuno:handle:"

/** One stable cosmetic handle per authenticated account, cached in this browser. */
export function getOrCreateHandle(userId: string): string {
  if (typeof window === "undefined" || !userId) return ""

  const key = STORAGE_PREFIX + userId
  const existing = window.localStorage.getItem(key)
  if (existing) return existing

  const handle = generateHandle()
  window.localStorage.setItem(key, handle)
  return handle
}
