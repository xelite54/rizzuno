export const MATCH_CALL_LIMIT_MS = 30 * 60 * 1000
export const MATCH_CALL_WARNING_SECONDS = 10

export function matchCallCountdown(expiresAt: number, now: number): number | null {
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return remaining <= MATCH_CALL_WARNING_SECONDS ? remaining : null
}
