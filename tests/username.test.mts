import assert from "node:assert/strict"
import { test } from "node:test"
import { USERNAME_MAX_LENGTH, USERNAME_PATTERN, normalizeUsername } from "../lib/username.ts"

test("usernames accept 3 through 17 allowed characters", () => {
  assert.equal(USERNAME_MAX_LENGTH, 17)
  for (const value of ["abc", "a_b.c123", "a".repeat(17)]) {
    assert.equal(USERNAME_PATTERN.test(value), true)
  }
})

test("username input only accepts English letters, digits, underscores, and dots", () => {
  assert.equal(normalizeUsername("AbC_12.name"), "abc_12.name")
  for (const value of ["name-test", "name@test", "名字123", "café", "Kelvin", "ＡＢＣ", "hi😀", "b!tch", "sh!t", "f@ggot", "fu\u200bck", null, 123]) {
    assert.equal(normalizeUsername(value), null, String(value))
  }
})

test("usernames reject over-limit, short, and invalid values", () => {
  for (const value of ["", "ab", "a".repeat(18), "a".repeat(24), "hello world", "hello!", "ABC", "abc\n"]) {
    assert.equal(USERNAME_PATTERN.test(value), false, JSON.stringify(value))
  }
})

test("profanity and slurs cannot bypass username checks through case, separators, digits, or affixes", () => {
  const words = ["fuck", "shit", "bitch", "cunt", "asshole", "nigger", "nigga", "faggot", "retard", "whitepower", "heilhitler"]
  for (const word of words) {
    const variants = [word, word.toUpperCase(), `xx${word}99`, word.split("").join("."), word.split("").join("_"), word.split("").map((c, i) => i % 2 ? c.toUpperCase() : c).join("._"), word.replace(/[aeiost]/g, (c) => ({ a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" })[c]!)]
    for (const variant of variants) assert.equal(normalizeUsername(variant), null, variant)
  }
  for (const value of ["fuuuck", "shiiit", "niggger", "n1_6.6_3r", "f...u___c.k", "xxF_U_C_Kxx", "niger", "f4gg07"]) {
    assert.equal(normalizeUsername(value), null, value)
  }
})

test("ordinary usernames retain valid separators, digits, and double letters", () => {
  for (const value of ["alice", "will_2026", "blue.sky", "hello_world", "skater99", "emma.rose"]) {
    assert.equal(normalizeUsername(value), value)
  }
})
