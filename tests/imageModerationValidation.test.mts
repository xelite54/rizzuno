import { test } from "node:test"
import assert from "node:assert/strict"
import { validateAndDecodeImage } from "../lib/imageModeration/imageValidation"
import { decideModeration } from "../lib/imageModeration/policy"
import { buildPngBytes, buildPngDataUrl } from "./helpers/pngFixture.mts"

// --- validateAndDecodeImage --------------------------------------------
// Step 2/3/4 of moderateImage()'s pipeline ("validate encoded image" /
// "validate actual decoded image type" / "enforce byte/dimension limits") —
// exercised directly here against real, well-formed and deliberately
// malformed bytes, independent of any provider or database.

test("validateAndDecodeImage: accepts a real, well-formed PNG within limits", () => {
  const result = validateAndDecodeImage(buildPngDataUrl(8, 8))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.format, "png")
    assert.equal(result.width, 8)
    assert.equal(result.height, 8)
  }
})

test("validateAndDecodeImage: rejects a non-string input", () => {
  const result = validateAndDecodeImage(undefined)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "invalid_data_url")
})

test("validateAndDecodeImage: rejects a data URL that isn't shaped like one", () => {
  const result = validateAndDecodeImage("not a data url at all")
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "invalid_data_url")
})

test("validateAndDecodeImage: rejects a claimed image/png prefix wrapped around bytes that aren't actually a PNG — the client's own content-type claim is never trusted", () => {
  // Real, decoded bytes here are plain text, not a PNG — only the data
  // URL's own prefix claims otherwise. This is exactly the "never trust
  // the client's Content-Type / data-URL prefix alone" requirement.
  const fakeBytes = Buffer.from("this is not an image at all, just text")
  const dataUrl = `data:image/png;base64,${fakeBytes.toString("base64")}`
  const result = validateAndDecodeImage(dataUrl)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "unsupported_format")
})

test("validateAndDecodeImage: rejects a format Rizzuno doesn't support (e.g. real ICNS magic bytes) even though the vulnerable image-size ICNS parser would happily try to decode it", () => {
  // GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq: image-size's ICNS/JXL/HEIF
  // parsers have an unpatched infinite-loop DoS. The magic-byte gate in
  // imageValidation.ts must reject bytes with an ICNS signature ("icns")
  // BEFORE image-size is ever called on them — this is the actual
  // mitigation, proven here by feeding it real ICNS magic bytes and
  // confirming they never make it past the format gate.
  const icnsBytes = Buffer.concat([Buffer.from("icns", "ascii"), Buffer.alloc(16)])
  const dataUrl = `data:image/png;base64,${icnsBytes.toString("base64")}`
  const result = validateAndDecodeImage(dataUrl)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "unsupported_format")
})

test("validateAndDecodeImage: rejects truncated/corrupt PNG bytes as malformed, not a crash", () => {
  const goodBytes = buildPngBytes(8, 8)
  const truncated = goodBytes.subarray(0, 10) // signature + a couple bytes in — nowhere near a full IHDR
  const dataUrl = `data:image/png;base64,${truncated.toString("base64")}`
  const result = validateAndDecodeImage(dataUrl)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "malformed_image")
})

test("validateAndDecodeImage: rejects dimensions below the minimum (decompression-bomb-style tiny-but-huge-canvas protection works the other direction too — this is the sanity floor)", () => {
  const result = validateAndDecodeImage(buildPngDataUrl(1, 1))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "dimensions_too_large")
})

test("validateAndDecodeImage: rejects a declared canvas larger than MAX_DIMENSION_PX", () => {
  // A real decoded header claiming an enormous canvas (with only a tiny
  // amount of actual IDAT data behind it, exactly like a real
  // decompression-bomb-style upload would supply — see buildPngBytes's own
  // doc comment) — this is what actually blocks that attack, read straight
  // from the header without ever allocating memory for the claimed pixels.
  const bytes = buildPngBytes(20000, 20000, 1)
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`
  const result = validateAndDecodeImage(dataUrl)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "dimensions_too_large")
})

test("validateAndDecodeImage: rejects an empty string", () => {
  const result = validateAndDecodeImage("")
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "invalid_data_url")
})

// --- decideModeration ----------------------------------------------------
// THE policy engine (lib/imageModeration/policy.ts) — every threshold and
// the "most severe category wins" rule, exercised directly against
// synthetic category scores, independent of any provider.

test("decideModeration: no categories at all -> allow", () => {
  assert.equal(decideModeration([]), "allow")
})

test("decideModeration: a low score on every category -> allow", () => {
  assert.equal(
    decideModeration([
      { category: "nudity", score: 0.01 },
      { category: "violence", score: 0.05 },
    ]),
    "allow"
  )
})

test("decideModeration: nudity above its block threshold -> block", () => {
  assert.equal(decideModeration([{ category: "nudity", score: 0.9 }]), "block")
})

test("decideModeration: nudity between review and block thresholds -> review", () => {
  assert.equal(decideModeration([{ category: "nudity", score: 0.3 }]), "review")
})

test("decideModeration: explicit sexual content at a decisive score -> block", () => {
  assert.equal(decideModeration([{ category: "explicit_sexual", score: 0.8 }]), "block")
})

test("decideModeration: graphic violence at a decisive score -> block", () => {
  assert.equal(decideModeration([{ category: "graphic_violence", score: 0.85 }]), "block")
})

test("decideModeration: gore at a decisive score -> block", () => {
  assert.equal(decideModeration([{ category: "gore", score: 0.7 }]), "block")
})

test("decideModeration: moderate violence lands on review, not block, per spec's 'moderate violence -> REVIEW'", () => {
  assert.equal(decideModeration([{ category: "violence", score: 0.4 }]), "review")
})

test("decideModeration: one severely-scored category among several low-scored ones still blocks the whole image — severity is never averaged away", () => {
  assert.equal(
    decideModeration([
      { category: "weapons", score: 0.02 },
      { category: "drugs", score: 0.01 },
      { category: "gore", score: 0.9 },
    ]),
    "block"
  )
})

test("decideModeration: csam_suspected at any nonzero score -> block, no review middle ground, even at a tiny score", () => {
  assert.equal(decideModeration([{ category: "csam_suspected", score: 0.0001 }]), "block")
})

test("decideModeration: csam_suspected at exactly zero (i.e. never actually flagged) contributes nothing", () => {
  assert.equal(decideModeration([{ category: "csam_suspected", score: 0 }]), "allow")
})

test("decideModeration: an unrecognized category name from a provider is ignored, never trusted to affect the decision", () => {
  // @ts-expect-error deliberately passing a category outside the known union, simulating a provider integration bug
  assert.equal(decideModeration([{ category: "not_a_real_category", score: 0.99 }]), "allow")
})
