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
  /\bnigg(?:er|a)s?\b/i,
  /\b(?:chinks?|gooks?|spics?|kikes?|wetbacks?|ragheads?|towelheads?|paki(?:s)?|coon(?:s)?)\b/i,
  /\bwhite\s+power\b/i,
  /\bheil\s+hitler\b/i,
  /\bretard(ed)?\b/i,
  /\bkill\s+yourself\b/i,
  /\bkys\b/i,
  /\bchild\s*porn\b/i,
  /\bcp\b\s*(pic|vid|link)/i,
  /\b(?:cocaine|heroin|meth(?:amphetamine)?|fentanyl|crack|mdma|ecstasy|molly|lsd|acid|ketamine|oxycontin|xanax|adderall|percocet|vicodin|shrooms?|psilocybin)\b/i,
]

export function containsSevereContent(text: string): boolean {
  // Lowercase explicitly rather than relying solely on each pattern's /i
  // flag — belt-and-suspenders so a slur in ANY casing (NIGGERS, NiggerS,
  // etc.) is caught even if a future pattern is added without /i.
  const lowered = text.toLowerCase()
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(lowered))
}

// Chat-only rules: do not change username or bio policy. Whole-word
// matching avoids blocking innocent words such as "grape" and "skill".
const CHAT_PATTERNS = [
  /\brap(?:e[ds]?|ing|ists?)\b/i,
  /\bsex(?:ual(?:ly)?|ting|ts|y)?\b/i,
  /\bporn(?:ography|ographic)?\b/i,
  /\b(?:kill(?:s|ed|ing)?|murder(?:s|ed|ing|er)?|stab(?:s|bed|bing)?|behead(?:s|ed|ing)?|tortur(?:e[ds]?|ing))\b/i,
  /\bshoot\s+(?:you|u|him|her|them|everyone)\b/i,
]

export const CHAT_BLOCKED_MESSAGE = "Message not sent. Please remove sexual or violent language."

export function containsBlockedChatContent(text: string): boolean {
  // Catch compatibility characters, invisible separators and common
  // substitutions. This is still a limited keyword filter, not a guarantee.
  const normalized = text.normalize("NFKC")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[0134@]/g, (character) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "@": "a" })[character]!)
  return containsSevereContent(normalized) || CHAT_PATTERNS.some((pattern) => pattern.test(normalized))
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
