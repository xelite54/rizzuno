import { REPORT_CATEGORIES, type ReportCategory } from "./signaling/protocol"

/**
 * The one reporting model's target vocabulary — safe to import from client
 * components (no server-only dependencies). Every report row carries one of
 * these as `reports.target_type`; the server alone resolves the target to
 * the responsible account (see lib/db.ts's resolveReportTarget()).
 */
export const REPORT_TARGET_TYPES = ["user", "post", "match", "message"] as const
export type ReportTargetType = typeof REPORT_TARGET_TYPES[number]
export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === "string" && (REPORT_TARGET_TYPES as readonly string[]).includes(value)
}

/**
 * The minimal reference a client sends. For `user` it is the public
 * username (a client never needs an account id to report a profile); for
 * `post`/`match`/`message` it is that record's opaque id. Never includes an
 * owner, sender or reported-account id — the server derives those.
 */
export type ReportTargetRef = { type: ReportTargetType; id: string }

/** Internal-only category for the linked moderation-history row of an NCII case; never accepted from the ordinary report path. */
export const NCII_REPORT_CATEGORY = "intimate_image"

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  sexual_content: "Sexual content", harassment: "Harassment", hate: "Hate", scam: "Scam", spam: "Spam",
  underage_concern: "Underage concern", violence: "Violence", other: "Other",
}

export type ReportReason = { value: ReportCategory; label: string; branch?: undefined } | { value: "ncii"; label: string; branch: "ncii" }

/** The reasons the shared Report dialog offers, in display order. The NCII
 * entry is a branch into the dedicated intake flow, not a report category. */
export const REPORT_REASONS: ReportReason[] = [
  ...(["sexual_content", "harassment", "hate", "violence", "scam", "spam", "underage_concern"] as const).map((value) => ({ value, label: REPORT_CATEGORY_LABELS[value] })),
  { value: "ncii", label: "Intimate image shared without consent", branch: "ncii" },
  { value: "other", label: REPORT_CATEGORY_LABELS.other },
]
// Every ordinary category stays reachable from the dialog.
if (REPORT_CATEGORIES.some((category) => !REPORT_REASONS.some((reason) => reason.value === category))) throw new Error("report reason list incomplete")

export function reportHeading(type: ReportTargetType): string {
  return type === "post" ? "Report post" : type === "message" ? "Report conversation" : "Report user"
}

export const TARGET_LABELS: Record<ReportTargetType, string> = { user: "User", post: "Post", match: "Match", message: "Message" }

export const NCII_RELATIONSHIPS = ["depicted_person", "authorized_representative"] as const
export type NciiRelationship = typeof NCII_RELATIONSHIPS[number]
