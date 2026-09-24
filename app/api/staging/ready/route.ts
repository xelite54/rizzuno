import { timingSafeEqual } from "node:crypto"
/** Non-production marker used only by the explicitly armed staging harness. */
export async function GET(request: Request) {
  const expected = process.env.STAGING_PROBE_SECRET
  const supplied = request.headers.get("x-staging-probe") ?? ""
  if (process.env.DEPLOYMENT_TIER !== "staging" || !expected || expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response(null,{status:404})
  return Response.json({ environment:"staging", revision:process.env.DEPLOYMENT_REVISION ?? null },{headers:{"Cache-Control":"no-store"}})
}
