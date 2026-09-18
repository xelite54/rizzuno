/** Shared server/client text screening. Normalization catches common evasion,
 * but keyword matching cannot guarantee detection of every harmful message. */
const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
}

// Common Cyrillic/Greek lookalikes used inside otherwise Latin words.
const LOOKALIKES: Record<string, string> = {
  "а": "a", "ɑ": "a", "α": "a", "е": "e", "ε": "e", "і": "i", "ι": "i", "ӏ": "i",
  "о": "o", "ο": "o", "р": "p", "ρ": "p", "с": "c", "ϲ": "c", "ѕ": "s",
  "у": "y", "х": "x", "χ": "x", "к": "k", "κ": "k", "т": "t", "τ": "t", "ν": "v",
}

function normalizeForFilter(text: string): string {
  return text.normalize("NFKD").toLowerCase()
    .replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/[аɑαеεіιӏоοрρсϲѕухχкκтτν]/gu, (character) => LOOKALIKES[character])
    .replace(/[0134578@$]/g, (character) => LEET_MAP[character])
}

const LETTER_VARIANTS: Record<string, string> = {
  g: "[g69]", i: "[i!|]", l: "[li!|]", z: "[z2]",
}
const SEPARATOR = "[^\\p{L}\\p{N}]*"

/** Match separators and stretching at every letter, keeping Unicode word
 * boundaries so innocent words such as raccoon and Essex stay usable.
 * Requiring dictionary double letters avoids treating Niger as a slur. */
function spacedOut(word: string, plural = false): RegExp {
  const letters = word.replace(/ /g, "").split("")
  const body = letters.map((letter, index) => {
    const token = LETTER_VARIANTS[letter] ?? letter
    // Only the final letter of a repeated run consumes extra copies.
    return letters[index + 1] === letter ? token : `${token}(?:${SEPARATOR}${token})*`
  }).join(SEPARATOR)
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${plural ? `(?:${SEPARATOR}s)?` : ""}(?![\\p{L}\\p{N}])`, "u")
}

// Racial/ethnic slurs, self-harm incitement, and CSAM-adjacent terms — kept
// as plain fused words (no internal spaces) specifically so spacedOut()
// can tolerate ANY separator a bypass might insert between every letter,
// not just the ones a hand-written regex happened to anticipate.
const SPACED_SEVERE_WORDS = [
  "faggot", "nigger", "nigga", "chink", "gook", "spic", "kike", "wetback",
  "raghead", "towelhead", "paki", "coon", "whitepower", "heilhitler",
  "killyourself", "kys", "childporn", "retard", "retarded",
]
const SPACED_SEVERE_PATTERNS = SPACED_SEVERE_WORDS.map((word) => spacedOut(word, true))

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

// Additional chat and bio rules. Whole-word
// matching avoids blocking innocent words such as "grape" and "skill".
const CHAT_PATTERNS = [
  /\brap(?:e[ds]?|ing|ists?)\b/i,
  /\bsex(?:ual(?:ly)?|ting|ts|y)?\b/i,
  /\bporn(?:ography|ographic)?\b/i,
  /\b(?:kill(?:s|ed|ing)?|murder(?:s|ed|ing|er)?|stab(?:s|bed|bing)?|behead(?:s|ed|ing)?|tortur(?:e[ds]?|ing))\b/i,
  /\bshoot\s+(?:you|u|him|her|them|everyone)\b/i,
]

const OBFUSCATED_CHAT_PATTERNS = [
  "rape", "raped", "rapes", "raping", "rapist", "rapists",
  "sex", "sexual", "sexually", "sexting", "sexts", "sexy",
  "porn", "pornography", "pornographic", "kill", "kills", "killed", "killing",
  "murder", "murders", "murdered", "murdering", "murderer",
  "stab", "stabs", "stabbed", "stabbing", "behead", "beheads", "beheaded", "beheading",
  "torture", "tortured", "tortures", "torturing",
  "shoot you", "shoot u", "shoot him", "shoot her", "shoot them", "shoot everyone",
].map((word) => spacedOut(word))

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
  return CHAT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    OBFUSCATED_CHAT_PATTERNS.some((pattern) => pattern.test(normalized))
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
