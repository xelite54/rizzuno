/**
 * A basic, keyword-only safety net for free-text fields (chat, username,
 * bio). This is intentionally simple and should be described honestly as
 * such — it catches obvious, severe terms plus the common ways people try
 * to sneak them past a keyword filter (see normalizeForFilter() and
 * spacedOut() below); it is not content moderation, doesn't understand
 * context, and still won't catch genuinely creative evasion or other
 * languages. Real moderation still depends on report + block + human
 * review (see app/admin). Never claim this filter means messages or profiles
 * are "reviewed" before appearing.
 */

// Unambiguous leetspeak substitutions only — deliberately no 6/9 (too
// often meant as literal digits/other letters) and no 1→l (1→i covers the
// common case without also rewriting every plain "1" that isn't standing
// in for a letter at all any more than this already does).
const LEET_MAP: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s" }

// Invisible/zero-width separators (ZERO WIDTH SPACE/NON-JOINER/JOINER, WORD
// JOINER, ZERO WIDTH NO-BREAK SPACE) — built from character codes rather
// than a literal escape in source, the same reasoning CONTROL_CHAR_PATTERN
// below already uses: keeps an actual invisible character from ever being
// pasted into the file itself, where it would be impossible to see or diff.
const ZERO_WIDTH_PATTERN = new RegExp(
  "[" + String.fromCharCode(0x200b) + "-" + String.fromCharCode(0x200d) +
    String.fromCharCode(0x2060) + String.fromCharCode(0xfeff) + "]",
  "g"
)

/**
 * The one normalization pass every check below runs on — de-obfuscates the
 * common tricks people use to sneak a blocked word past a keyword filter,
 * all at once, so a bypass has to dodge every one of these simultaneously
 * rather than just whichever this filter happened to check for before:
 *   - Unicode compatibility forms + invisible/zero-width separators
 *     ("n" + U+200B + "igger" — a zero-width space slipped between letters)
 *   - leetspeak digit/symbol substitution ("n1gg3r")
 *   - stretched-out spelling ("niggggger") — 3+ repeats of the same letter
 *     collapse to 2, which ordinary English essentially never needs
 *     (a genuine double letter like "will" or "committee" is untouched;
 *     this only fires on runs of 3+)
 * Deliberately does NOT remove spaces/punctuation between letters — that
 * would merge unrelated words together and invent false positives out of
 * ordinary sentences. spacedOut() below handles the "n.i.g.g.e.r" /
 * "n i g g e r" bypass a different, much narrower way instead.
 */
function normalizeForFilter(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH_PATTERN, "")
    .toLowerCase()
    .replace(/[0134578@$]/g, (character) => LEET_MAP[character] ?? character)
    .replace(/([a-z])\1{2,}/g, "$1$1")
}

function escapeRegexChar(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Builds a pattern matching `word`'s letters in order, tolerating up to 2
 * inserted non-alphanumeric characters between each one — the "n.i.g.g.e.r"
 * / "n i g g e r" / "n-i-g-g-e-r" bypass — while still requiring the match
 * not be embedded inside a longer run of letters on either side, the same
 * protection a plain `\b` boundary gives a non-spaced word, just tolerant
 * of gaps *inside*. That boundary check is what keeps this safe against
 * false positives on ordinary words that happen to contain the same
 * letters run together: "raccoon" never matches a spaced "coon" (the "c"
 * immediately before its own "coon" substring is itself a letter, which
 * fails the lookbehind), and "niggling" never matches spaced "nigger"
 * (there's no "e" where the pattern needs one, and the gap-matcher can't
 * skip over an actual letter to go find one further along).
 */
function spacedOut(word: string): RegExp {
  const body = word.split("").map(escapeRegexChar).join("[\\W_]{0,2}")
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i")
}

// Racial/ethnic slurs, self-harm incitement, and CSAM-adjacent terms — kept
// as plain fused words (no internal spaces) specifically so spacedOut()
// can tolerate ANY separator a bypass might insert between every letter,
// not just the ones a hand-written regex happened to anticipate.
const SPACED_SEVERE_WORDS = [
  "faggot", "nigger", "nigga", "chink", "gook", "spic", "kike", "wetback",
  "raghead", "towelhead", "paki", "coon", "whitepower", "heilhitler",
  "killyourself", "kys", "childporn",
]
const SPACED_SEVERE_PATTERNS = SPACED_SEVERE_WORDS.map(spacedOut)

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
  /\b(?:cocaine|heroin|meth(?:amphetamine)?|fentanyl|crack|mdma|ecstasy|molly|lsd|acid|ketamine|oxycontin|xanax|adderall|percocet|vicodin|shrooms?|psilocybin|weed|marijuana|cannabis|kush)\b/i,
]

// Drug-dealing SOLICITATION — a selling/contact phrase near a drug
// reference, checked in both orders ("selling molly hmu" / "got zaza for
// sale"). Kept separate from BLOCKED_PATTERNS' plain drug-name list above:
// this is what lets genuinely ambiguous slang ("ice", "gas", "loud",
// "fire", "blow", "coke" — all ordinary words on their own, frozen water/
// car fuel/a compliment/a soda/a verb) only ever trigger when it's
// actually paired with dealing language nearby, rather than blocking
// those words outright the way the unambiguous names above are.
const DEALING_VERBS = "(?:sell(?:ing)?|deal(?:ing|er)?|plug(?:ging)?|suppl(?:y|ying|ier)|hook(?:ing)?\\s*up|hmu|dm\\s*me|hit\\s*me\\s*up|slide\\s*through|got\\s*(?:that|some)|for\\s*sale)"
const DRUG_SLANG = "(?:weed|marijuana|cannabis|kush|dope|blow|coke|cocaine|heroin|meth(?:amphetamine)?|fentanyl|crack|mdma|ecstasy|molly|lsd|acid|ketamine|oxy(?:contin)?|xan(?:ax|s)?|adderall|addys?|percocet|percs?|perks?|vicodin|shrooms?|psilocybin|ice|tina|china\\s*white|zaza|gas|loud|fire)"
const DEALING_PATTERNS: RegExp[] = [
  new RegExp(`\\b${DEALING_VERBS}\\b[^.!?\\n]{0,25}\\b${DRUG_SLANG}\\b`, "i"),
  new RegExp(`\\b${DRUG_SLANG}\\b[^.!?\\n]{0,25}\\b${DEALING_VERBS}\\b`, "i"),
]

/**
 * Severe content — the one check applied EVERYWHERE free text is accepted
 * (chat, bio, username; see containsBlockedChatContent() below for chat's
 * own additional context-specific rules). Runs the shared de-obfuscation
 * pass (normalizeForFilter) itself now, rather than trusting each caller
 * to have already normalized — server/ws-server.ts's username checks call
 * this directly with completely raw text, and need the exact same
 * bypass-resistance chat/bio already get.
 */
export function containsSevereContent(text: string): boolean {
  const normalized = normalizeForFilter(text)
  return (
    BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    SPACED_SEVERE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    DEALING_PATTERNS.some((pattern) => pattern.test(normalized))
  )
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

/**
 * The shared check behind BOTH live chat surfaces — friend chat
 * (server/ws-server.ts's "friend-chat-send") and live match chat (the
 * "chat" case right next to it) — so an improvement here (this function,
 * or containsSevereContent()/normalizeForFilter() it calls) protects both
 * at once, never just one of them.
 */
export function containsBlockedChatContent(text: string): boolean {
  if (containsSevereContent(text)) return true
  const normalized = normalizeForFilter(text)
  return CHAT_PATTERNS.some((pattern) => pattern.test(normalized))
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

// Tab/newline/CR plus the printable ASCII range — everything sanitizeText()
// already lets through MINUS anything outside plain English text (accented
// Latin, CJK, Cyrillic, Arabic/Hebrew, emoji, etc.).
const NON_ENGLISH_PATTERN = /[^\t\n\r\x20-\x7E]/g

/** English-only free-text fields (currently just the bio — see MyProfileSheet.tsx's live-filtered textarea and app/api/profile/me's PUT handler, its server-side backstop): drops any character outside plain ASCII rather than rejecting the whole edit, the same "quietly normalize, don't block" treatment sanitizeText() already gives control characters. */
export function stripNonEnglish(input: string): string {
  return input.replace(NON_ENGLISH_PATTERN, "")
}
