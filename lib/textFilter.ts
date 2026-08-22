/**
 * A basic, keyword-only safety net for free-text fields (chat, username,
 * bio). This is intentionally simple and should be described honestly as
 * such — it catches obvious, severe terms; it is not content moderation,
 * doesn't understand context, and won't catch evasion (spacing, leetspeak,
 * other languages). Real moderation still depends on report + block + human
 * review (see app/admin). Never claim this filter means messages or profiles
 * are "reviewed" before appearing.
 */

const BLOCKED_PATTERNS: RegExp[] = [
  /\bfaggot\b/i,
  /\bnigger\b/i,
  /\bretard(ed)?\b/i,
  /\bkill\s+yourself\b/i,
  /\bkys\b/i,
  /\bchild\s*porn\b/i,
  /\bcp\b\s*(pic|vid|link)/i,
]

export function containsSevereContent(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text))
}

// Control characters (C0 + DEL), built from character codes rather than a
// literal escape in source — keeps an actual control byte from ever being
// pasted into the file itself.
const CONTROL_CHAR_PATTERN = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) +
    String.fromCharCode(11) + String.fromCharCode(12) +
    String.fromCharCode(14) + "-" + String.fromCharCode(31) +
    String.fromCharCode(127) + "]",
  "g"
)

/** Strips control characters (including ones that could smuggle terminal/markup tricks) and clamps length — applied to every free-text field before it's stored or relayed. */
export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return ""
  const stripped = input.replace(CONTROL_CHAR_PATTERN, "")
  return stripped.trim().slice(0, maxLength)
}
