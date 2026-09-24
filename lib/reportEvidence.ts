/** Memory-only recent text; no media recording, screenshots or image bytes. */
export type ReportChatEntry = { senderId: string; text: string; timestamp: number }
export const REPORT_CHAT_LIMIT = 20
export const REPORT_CHAT_WINDOW_MS = 120_000
export function boundedReportChat(entries: ReportChatEntry[], at = Date.now()): ReportChatEntry[] {
  return entries.filter(entry => Number.isSafeInteger(entry.timestamp) && entry.timestamp <= at && entry.timestamp >= at - REPORT_CHAT_WINDOW_MS)
    .slice(-REPORT_CHAT_LIMIT).map(entry => ({ senderId: entry.senderId, text: entry.text.slice(0, 500), timestamp: entry.timestamp }))
}
/** Reserved interface, deliberately no active browser-capture adapter. Enabling
 * requires policy, consent, private evidence storage and specialist safety review. */
export interface ApprovedReportCapture {
  capture(reportId: string): Promise<{ evidenceKey: string; sha256: string; capturedAt: number }>
}
