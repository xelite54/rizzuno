const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** A full date once per day ("2026 September 18") — callers show just the time for messages within that same day. */
export function formatDayLabel(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}
