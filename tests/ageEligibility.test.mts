import { test } from "node:test"
import assert from "node:assert/strict"
import { createEligibilityToken, evaluateDateOfBirth, readEligibilityToken } from "../lib/preAuthEligibility.ts"

const env={AUTH_SECRET:"test-only-secret-that-is-at-least-32-characters"}
test("pre-OAuth age check rejects under-18 and invalid dates without retaining DOB",async()=>{
  const today=new Date("2026-09-25T12:00:00Z")
  assert.equal(evaluateDateOfBirth("2008-09-25",true,today),true)
  assert.equal(evaluateDateOfBirth("2008-09-26",true,today),false)
  assert.equal(evaluateDateOfBirth("2000-02-30",true,today),false)
  assert.equal(evaluateDateOfBirth("2000-01-01",false,today),false)
  const token=await createEligibilityToken(true,today.getTime(),env)
  assert.equal((await readEligibilityToken(token,today.getTime(),env))?.eligible,true)
  assert.equal(token.includes("2008"),false)
  assert.equal(await readEligibilityToken(`${token}x`,today.getTime(),env),null)
})
