import sharp from "sharp"
import { validateAndDecodeImage } from "./imageValidation"

/** Decode every pixel and re-encode, dropping metadata/trailing scripts. No SVG.
 * Animated uploads are rejected rather than moderating only their first frame. */
export async function normalizeImage(dataUrl: string): Promise<Buffer> {
  const input = validateAndDecodeImage(dataUrl)
  if (!input.ok) throw new Error("invalid_image")
  const image = sharp(input.bytes, { failOn: "warning", limitInputPixels: 36_000_000 })
  const metadata = await image.metadata()
  if ((metadata.pages ?? 1) !== 1) throw new Error("animated_image_unsupported")
  const bytes = await image.rotate().webp({ quality: 90 }).toBuffer()
  if (bytes.length > 3_000_000) throw new Error("image_too_large")
  return bytes
}
