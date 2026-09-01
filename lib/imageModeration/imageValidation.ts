import { imageSize } from "image-size"

/**
 * Server-side image validation — step 2 of moderateImage()'s pipeline
 * ("validate encoded image" / "validate actual decoded image type" /
 * "enforce byte/dimension limits"). Never trusts a file extension, a
 * client-supplied Content-Type, or a data URL's own "image/xxx" prefix —
 * every one of those is exactly the kind of claim a malicious client can
 * lie about. The only thing trusted here is the real, decoded byte content
 * itself.
 */

export type DetectedFormat = "png" | "jpeg" | "gif" | "webp"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const GIF87_SIGNATURE = Buffer.from("GIF87a", "ascii")
const GIF89_SIGNATURE = Buffer.from("GIF89a", "ascii")

/** What image-size's own `type` field calls each format we accept — cross-checked against our own magic-byte detection below so the two can never quietly disagree. */
const IMAGE_SIZE_TYPE_BY_FORMAT: Record<DetectedFormat, string> = {
  png: "png",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
}

/**
 * Determines the REAL format from the first few bytes — this is what
 * "actual decoded image type" means here: not the data URL's own
 * "image/png" claim, the real magic number. Only ever recognizes exactly
 * the four formats server/ws-server.ts and the profile/post routes already
 * accept; anything else (including a perfectly valid image in a format
 * Rizzuno simply doesn't support) is rejected as unsupported.
 *
 * This check runs BEFORE image-size ever sees the buffer (see
 * validateAndDecodeImage below) — deliberately: image-size (the
 * `image-size` npm package) has a real, disclosed, unpatched
 * vulnerability (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq — infinite loops
 * in its ICNS/JXL/HEIF header parsers) that a crafted file could trigger.
 * Gating on these four signatures FIRST means image-size is never invoked
 * on anything but bytes already independently confirmed to carry a
 * PNG/JPEG/GIF/WebP magic number — the vulnerable format parsers can only
 * ever be reached by bytes with ICNS/JXL/HEIF's own distinct signatures,
 * which by construction can never pass this check.
 */
function detectFormatFromMagicBytes(bytes: Buffer): DetectedFormat | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png"
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) return "jpeg"
  if (bytes.length >= 6 && (bytes.subarray(0, 6).equals(GIF87_SIGNATURE) || bytes.subarray(0, 6).equals(GIF89_SIGNATURE))) {
    return "gif"
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp"
  }
  return null
}

// String length of the data URL itself — cheap, checked before any
// decoding happens at all.
const MAX_DATA_URL_LENGTH = 2_000_000
// Decoded byte length — the real enforcement point; base64 overhead means
// this is always somewhat smaller than MAX_DATA_URL_LENGTH.
const MAX_DECODED_BYTES = 1_600_000
// Declared pixel dimensions, read from the header only (image-size never
// decodes full pixel data) — this is what actually blocks a
// decompression-bomb-style upload (a tiny file claiming an enormous
// canvas) without ever allocating memory for one.
const MAX_DIMENSION_PX = 6000
const MIN_DIMENSION_PX = 4

const DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+=*)$/i

export type ImageValidationResult =
  | { ok: true; format: DetectedFormat; bytes: Buffer; width: number; height: number }
  | {
      ok: false
      reason: "invalid_data_url" | "unsupported_format" | "too_large" | "dimensions_too_large" | "malformed_image"
    }

/**
 * The whole "validate encoded image → validate actual decoded image type →
 * enforce byte/dimension limits" stretch of moderateImage()'s pipeline, in
 * one function. Never throws — every failure mode is a typed `reason` the
 * caller can log/branch on, never an uncaught exception from a malformed
 * or hostile input.
 */
export function validateAndDecodeImage(dataUrl: unknown): ImageValidationResult {
  if (typeof dataUrl !== "string" || dataUrl.length === 0 || dataUrl.length > MAX_DATA_URL_LENGTH) {
    return { ok: false, reason: "invalid_data_url" }
  }

  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) return { ok: false, reason: "invalid_data_url" }

  let bytes: Buffer
  try {
    bytes = Buffer.from(match[1], "base64")
  } catch {
    return { ok: false, reason: "invalid_data_url" }
  }
  if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) {
    return { ok: false, reason: "too_large" }
  }

  const format = detectFormatFromMagicBytes(bytes)
  if (!format) return { ok: false, reason: "unsupported_format" }

  let dimensions: { width?: number; height?: number; type?: string }
  try {
    dimensions = imageSize(bytes)
  } catch {
    return { ok: false, reason: "malformed_image" }
  }

  const { width, height, type } = dimensions
  if (!width || !height || type !== IMAGE_SIZE_TYPE_BY_FORMAT[format]) {
    // image-size disagreeing with our own magic-byte detection is treated
    // as malformed, not "trust whichever" — a mismatch here is exactly
    // the kind of ambiguity a hostile file would try to exploit.
    return { ok: false, reason: "malformed_image" }
  }
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX || width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
    return { ok: false, reason: "dimensions_too_large" }
  }

  return { ok: true, format, bytes, width, height }
}
