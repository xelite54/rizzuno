import { test } from "node:test"
import assert from "node:assert/strict"
import { createEligibilityToken, eligibilitySatisfies, readEligibilityToken } from "../lib/preAuthEligibility.ts"
import { agePolicyForLocation, validateAgePolicies } from "../lib/agePolicy.ts"

const env={AUTH_SECRET:"test-only-secret-that-is-at-least-32-characters"}
test("signed declarations expire, reject tampering and contain no DOB",async()=>{
  const now=Date.now()
  const token=await createEligibilityToken(true,now,env)
  const claim=await readEligibilityToken(token,now,env)
  assert.equal(claim?.eligible,true)
  assert.equal(claim?.method,"self_attestation")
  assert.equal("dateOfBirth" in claim!,false)
  assert.equal(await readEligibilityToken(`${token}x`,now,env),null)
  assert.equal(await readEligibilityToken(token,now+86_400_000,env),null)
  assert.equal(await readEligibilityToken(token,now-61_000,env),null)
  assert.equal(await readEligibilityToken("x".repeat(5000),now,env),null)
  assert.equal(await readEligibilityToken(token,now,{AUTH_SECRET:"another-secret"}),null)
})
const entry={status:"approved",minimumAge:18,mode:"self_attestation",reference:"test review",reviewBy:"2099-01-01"}
test("policy requires geographic approval and documented current review, without a development fallback",()=>{
  const config={NODE_ENV:"production",SUPPORTED_COUNTRIES:"JP",AGE_POLICIES_JSON:JSON.stringify({JP:entry})}
  assert.equal(agePolicyForLocation(null,null,config),null)
  assert.equal(agePolicyForLocation("US",null,config),null)
  assert.equal(agePolicyForLocation("US","TX",config),null)
  assert.equal(agePolicyForLocation("US","MS",config),null)
  assert.equal(agePolicyForLocation("US","AL",config),null)
  assert.equal(agePolicyForLocation("US","NE",config),null)
  assert.equal(agePolicyForLocation("US","NY",config),null)
  assert.equal(agePolicyForLocation("JP",null,config)?.minimumAge,18)
  assert.equal(agePolicyForLocation(null,null,{NODE_ENV:"development"}),null)
  assert.throws(()=>validateAgePolicies(["US"],["NY","TX"],config),/Missing or expired/)
  assert.equal(agePolicyForLocation("JP",null,{...config,AGE_POLICIES_JSON:JSON.stringify({JP:{...entry,reviewBy:"2000-01-01"}})}),null)
})
test("self-attestation cannot satisfy provider policy; policy changes invalidate prior eligibility",async()=>{
  const config={NODE_ENV:"production",SUPPORTED_COUNTRIES:"JP",AGE_POLICIES_JSON:JSON.stringify({JP:{...entry,mode:"provider"}})}
  const policy=agePolicyForLocation("JP",null,config)!
  const now=Date.now()
  const details={method:"self_attestation" as const,policyKey:policy.key,minimumAge:18,expiresAt:now+60000}
  const declared=await readEligibilityToken(await createEligibilityToken(true,now,env,details),now,env)
  assert.equal(eligibilitySatisfies(declared,policy),false)
  const assured=await readEligibilityToken(await createEligibilityToken(true,now,env,{...details,method:"provider"}),now,env)
  assert.equal(eligibilitySatisfies(assured,policy),true)
  assert.equal(eligibilitySatisfies(assured,{...policy,key:"new-review"}),false)
  assert.equal(eligibilitySatisfies(assured,{...policy,mode:"unavailable"}),false)
  assert.equal(eligibilitySatisfies(assured,{...policy,minimumAge:21}),false)
})
