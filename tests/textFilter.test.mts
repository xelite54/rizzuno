import { test } from "node:test"
import assert from "node:assert/strict"
import { containsBlockedChatContent } from "../lib/textFilter.ts"

test("chat filters sexual and violent terms, including common variants", () => {
  for (const text of ["rape", "SEX", "raping", "rapist", "sexting", "porn", "kill yourself", "murder", "stabbing", "beheading", "torture", "shoot you", "r@pe", "s3x", "ＳＥＸ", "s\u200bex"]) {
    assert.equal(containsBlockedChatContent(text), true, text)
  }
})

test("chat preserves normal conversation and innocent substrings", () => {
  for (const text of ["hello there", "grape juice", "scraped my knee", "Essex", "skill", "a photo shoot", "purple and pink"]) {
    assert.equal(containsBlockedChatContent(text), false, text)
  }
})

test("chat blocks racist slurs, plurals, and common obfuscation", () => {
  for (const text of ["nigga", "NIGGER", "niggas", "n1gg3r", "n\u200bigga", "chink", "gook", "spic", "kike", "wetback", "raghead", "white power", "heil hitler"]) {
    assert.equal(containsBlockedChatContent(text), true, text)
  }
  for (const text of ["spicy food", "raccoon", "Pakistan", "night", "I like purple"]) {
    assert.equal(containsBlockedChatContent(text), false, text)
  }
})
