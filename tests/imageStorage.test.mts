import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { storeApprovedImage } from "../lib/imageStorage.ts"
import { normalizeImage } from "../lib/imageModeration/normalize.ts"
import { buildPngDataUrl, buildPngBytes } from "./helpers/pngFixture.mts"

test("full decode rejects truncated pixels and mismatched MIME; re-encoding strips appended scripts", async () => {
  await assert.rejects(normalizeImage(buildPngDataUrl(8,8).replace("image/png", "image/jpeg")))
  await assert.rejects(normalizeImage(`data:image/png;base64,${buildPngBytes(8,100,1).toString("base64")}`))
  const original = buildPngBytes(8,8)
  const normalized = await normalizeImage(`data:image/png;base64,${Buffer.concat([original,Buffer.from('<script>alert(1)</script>')]).toString("base64")}`)
  assert.equal(normalized.includes(Buffer.from("<script>")),false)
  assert.deepEqual(normalized, await normalizeImage(buildPngDataUrl(8,8)))
})
test("rejection never uploads; public bucket and corrupt readback never produce a reference", async () => {
  process.env.IMAGE_STORAGE_URL="https://storage.invalid"
  process.env.IMAGE_STORAGE_KEY="test-only"
  process.env.IMAGE_STORAGE_BUCKET="images"
  const bytes = await normalizeImage(buildPngDataUrl(8,8))
  const allow = { decision:"allow" as const, provider:"test", categories:[], moderationId:"test", approvedDataUrl:`data:image/webp;base64,${bytes.toString("base64")}` }
  let uploaded = 0, isPublic=false, corrupt=false
  const fetchMock = mock.method(globalThis,"fetch",async (input: string, init: RequestInit) => {
    if (input.includes("/bucket/")) return Response.json({public:isPublic})
    if (init.method === "POST") { uploaded++; assert.equal(new Headers(init.headers).get("Content-Type"),"image/webp"); return Response.json({}) }
    return new Response(new Uint8Array(corrupt ? Buffer.from("wrong") : bytes))
  })
  try {
    await assert.rejects(storeApprovedImage({...allow,decision:"block"})); assert.equal(uploaded,0)
    isPublic=true; await assert.rejects(storeApprovedImage(allow)); assert.equal(uploaded,0)
    isPublic=false; corrupt=true; await assert.rejects(storeApprovedImage(allow),/verification/)
    corrupt=false; assert.match(await storeApprovedImage(allow),/^\/api\/media\/[0-9a-f-]+\.webp$/)
  } finally { fetchMock.mock.restore() }
})
