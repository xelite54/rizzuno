const HOUR_MS = 60 * 60 * 1000

/** Product reporting window, supplied by the operator for production. This
 * is not presented as a legally required retention period. */
export function recentMatchReportWindowMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RECENT_MATCH_REPORT_WINDOW_HOURS
  if (!raw && env.NODE_ENV !== "production") return 24 * HOUR_MS
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error("Invalid configuration: RECENT_MATCH_REPORT_WINDOW_HOURS")
  const hours = Number(raw)
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) throw new Error("Invalid configuration: RECENT_MATCH_REPORT_WINDOW_HOURS")
  return hours * HOUR_MS
}
