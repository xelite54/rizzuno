export const USERNAME_MAX_LENGTH = 17
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,17}$/

/** Validate the original ASCII input before lowercasing Unicode characters. */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null
  const value = input.trim()
  return /^[a-zA-Z0-9_.]{3,17}$/.test(value) ? value.toLowerCase() : null
}
