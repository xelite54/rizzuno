import { test } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { proxy } from "../proxy.ts"
import { AGE_ELIGIBILITY_COOKIE, createEligibilityToken } from "../lib/preAuthEligibility.ts"
import { configureTestAccess } from "./helpers/accessPolicy.mts"
import { agePolicyForLocation } from "../lib/agePolicy.ts"

test("Google OAuth endpoints fail closed until the signed pre-auth eligibility check passes",async()=>{
  const before=process.env.AUTH_SECRET
  process.env.AUTH_SECRET="test-only-proxy-secret-that-is-at-least-32-chars"
  configureTestAccess(); process.env.VERCEL="1"
  const location = {"x-vercel-ip-country":"JP"}
  const policy = agePolicyForLocation("JP",null)!
  const details = {method:"self_attestation" as const,policyKey:policy.key,minimumAge:18,expiresAt:Date.now()+60000}
  try {
    const denied=await proxy(new NextRequest("http://localhost/api/auth/signin/google",{method:"POST",headers:location}))
    assert.equal(denied.status,403)
    const token=await createEligibilityToken(true,Date.now(),undefined,details)
    const allowed=await proxy(new NextRequest("http://localhost/api/auth/signin/google",{method:"POST",headers:{...location,cookie:`${AGE_ELIGIBILITY_COOKIE}=${token}`}}))
    assert.equal(allowed.status,200)
    const ineligible=await createEligibilityToken(false,Date.now(),undefined,details)
    const refused=await proxy(new NextRequest("http://localhost/api/auth/callback/google",{headers:{...location,cookie:`${AGE_ELIGIBILITY_COOKIE}=${ineligible}`}}))
    assert.equal(refused.status,403)
  } finally { if(before===undefined)delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET=before }
})
