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
  for (const value of ["name-test", "name@test", "名字123", "café", "Kelvin", "ＡＢＣ", "hi😀", null, 123]) {
    assert.equal(normalizeUsername(value), null, String(value))
  }
})

test("usernames reject over-limit, short, and invalid values", () => {
  for (const value of ["", "ab", "a".repeat(18), "a".repeat(24), "hello world", "hello!", "ABC", "abc\n"]) {
    assert.equal(USERNAME_PATTERN.test(value), false, JSON.stringify(value))
  }
})
