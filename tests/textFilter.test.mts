import { test } from "node:test"
import assert from "node:assert/strict"
import { containsSevereContent, containsBlockedChatContent } from "../lib/textFilter.ts"

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


test("shared profile and chat screening rejects punctuation, Unicode, and stretched slurs", () => {
  for (const word of ["nigger", "nigga", "chink", "faggot", "wetback", "retarded"]) {
    for (const separator of [".", "....", "_", " - ", "\n", "😀", "\u200b", "\u2066"]) {
      for (const value of [word.split("").join(separator), `${word.split("").join(separator)}s`]) {
        assert.equal(containsSevereContent(value), true, value)
        assert.equal(containsBlockedChatContent(value), true, value)
      }
    }
    assert.equal(containsSevereContent(word.split("").map((letter) => letter.repeat(3)).join(".")), true, word)
  }
  for (const value of ["nіggеr", "nïggér", "n1.6.6.3r", "n!ggers", "ＮＩＧＧＥＲ"]) {
    assert.equal(containsSevereContent(value), true, value)
  }
})

test("chat and bio policy also checks obfuscated sexual and violent language", () => {
  for (const value of ["s....e....x", "p_o_r_n", "r...a...p...i...s...t", "k.i.l.l yourself", "shооt you", "muuurder", "s.e.x.u.a.l.l.y"]) {
    assert.equal(containsBlockedChatContent(value), true, value)
  }
})

test("normal words and international conversation survive normalization", () => {
  for (const value of ["Niger", "Nigeria", "raccoon", "spicy", "skill", "Essex", "hello!!!", "café", "こんにちは", "a big green tree", "will you call me", "s".repeat(2000)]) {
    assert.equal(containsBlockedChatContent(value), false, value)
  }
})
