/** Maps report-path errors to safe client responses. Never echoes target,
 * owner, report or reporter ids — only a stable error code. */
export function reportErrorResponse(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : ""
  if (message === "content_unavailable" || message === "match_not_reportable") return Response.json({ error: "content_unavailable" }, { status: 404 })
  if (["invalid_target", "invalid_match", "invalid_report", "invalid_request", "cannot_report_self", "description_required"].includes(message)) {
    return Response.json({ error: message === "description_required" ? message : "invalid_request" }, { status: 400 })
  }
  if (message === "rate_limited") return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } })
  return null
}
