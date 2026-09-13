import { containsSevereContent } from "./textFilter"

export const USERNAME_MAX_LENGTH = 17
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,17}$/
export const USERNAME_BLOCKED_MESSAGE = "Choose a username without profanity or hateful language."

// Usernames have no sentence context: check inside prefixes/suffixes too.
// Keep this stricter policy separate from chat and bio moderation.
const BLOCKED_USERNAME_WORDS = [
  "fuck", "shit", "bitch", "cunt", "ass", "arse", "bastard", "damn",
  "dick", "cock", "pussy", "prick", "twat", "wank", "whore", "slut",
  "piss", "bollock", "bugger", "douche", "motherfucker", "fuk", "fck", "stfu",
  "tits", "titties", "jizz", "cum", "blowjob", "handjob", "porn",
  "faggot", "fag", "nigger", "nigga", "chink", "gook", "spic", "kike",
  "wetback", "raghead", "towelhead", "paki", "coon", "tranny", "retard",
  "whitepower", "heilhitler", "siegheil", "nazi", "killyourself", "kys", "childporn",
]
const LETTER_VARIANTS: Record<string, string> = {
  a: "[a4]", b: "[b8]", e: "[e3]", g: "[g69]", i: "[i1]",
  l: "[l1]", o: "[o0]", s: "[s5]", t: "[t7]", z: "[z2]",
}
const BLOCKED_USERNAME_PATTERNS = BLOCKED_USERNAME_WORDS.map((word) =>
  // Collapse the dictionary's double letters, then allow any run length.
  // This catches both stretched spellings and dropped duplicate letters.
  new RegExp(word.replace(/(.)\1+/g, "$1").split("").map((letter) => `${LETTER_VARIANTS[letter] ?? letter}+`).join(""))
)

export function containsBlockedUsername(input: string): boolean {
  const value = input.trim()
  if (value.length > USERNAME_MAX_LENGTH) return false // Format validation rejects these.
  const compact = value.toLowerCase().replace(/[._]/g, "")
  return containsSevereContent(value) || BLOCKED_USERNAME_PATTERNS.some((pattern) => pattern.test(compact))
}

/** Validate the original ASCII input before lowercasing Unicode characters. */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null
  const value = input.trim()
  return /^[a-zA-Z0-9_.]{3,17}$/.test(value) && !containsBlockedUsername(value) ? value.toLowerCase() : null
}
