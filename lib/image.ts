"use client"

/**
 * Downscales an image file to a JPEG data URL before it's sent anywhere —
 * chat images travel over the WebSocket as plain JSON, so keeping them
 * small matters. Everything happens client-side via canvas; nothing is
 * uploaded to a server for this.
 */
export async function resizeImageToDataUrl(file: File, maxDimension = 640, quality = 0.75): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D context unavailable")
    ctx.drawImage(bitmap, 0, 0, width, height)

    return canvas.toDataURL("image/jpeg", quality)
  } finally {
    bitmap.close()
  }
}

// Rizzuno posts are standardized around one portrait shape — see
// cropAndResizePostToDataUrl's own doc comment for what each of these
// actually gates.
export const POST_TARGET_WIDTH = 1080
export const POST_TARGET_HEIGHT = 1350 // 1080×1350 = 4:5
export const POST_MIN_WIDTH = 640
export const POST_MIN_HEIGHT = 800 // 640×800 = 4:5 — the smallest crop this will ever accept
export const POST_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10MB, before any of this ever runs

export type PostImageErrorReason = "too_large" | "too_small" | "unsupported"

/** Thrown by cropAndResizePostToDataUrl() for every rejection it can produce — callers (MyProfileSheet.tsx) branch on `reason` to show the right message. */
export class PostImageError extends Error {
  constructor(public readonly reason: PostImageErrorReason) {
    super(reason)
    this.name = "PostImageError"
  }
}

/**
 * Standardizes a picked post photo around Rizzuno's one portrait shape,
 * entirely client-side via canvas:
 *
 * 1. Rejects the raw file outright above POST_MAX_UPLOAD_BYTES — before
 *    ever decoding it.
 * 2. Center-crops the decoded image to exactly 4:5 (portrait) — the
 *    largest 4:5 rectangle that fits centered inside whatever the source
 *    photo's own aspect ratio actually is. A photo already shot at 4:5
 *    passes straight through this untouched.
 * 3. Rejects the photo if that centered crop would come out smaller than
 *    POST_MIN_WIDTH×POST_MIN_HEIGHT — there's no manual crop/zoom step
 *    (yet) to work around too little native resolution, so a photo that
 *    can't reach the floor at 4:5 is refused rather than silently upscaled
 *    into a blurry post.
 * 4. Scales that crop DOWN (never up) to at most
 *    POST_TARGET_WIDTH×POST_TARGET_HEIGHT — a smaller-but-still-above-the-
 *    floor crop is kept at its own native size rather than upscaled to
 *    the target for no real quality gain.
 * 5. Encodes to WebP (canvas's one broadly-supported compressed format;
 *    real browsers cannot canvas-encode AVIF today) at `quality` — a
 *    browser too old to support WebP encoding gets back a PNG from
 *    canvas.toDataURL instead (silently, this is toDataURL's own
 *    documented fallback, not an error), so this never actually throws
 *    over that.
 *
 * Server-side, this same data URL still goes through
 * lib/imageModeration/imageValidation.ts's own independent byte/dimension
 * checks (never trusted at face value just because it came from here) —
 * this function is what keeps a normal upload comfortably inside those
 * limits, not a replacement for them.
 */
export async function cropAndResizePostToDataUrl(file: File, quality = 0.82): Promise<string> {
  if (file.size > POST_MAX_UPLOAD_BYTES) throw new PostImageError("too_large")

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PostImageError("unsupported")
  }

  try {
    const targetRatio = POST_TARGET_WIDTH / POST_TARGET_HEIGHT // 4/5
    const sourceRatio = bitmap.width / bitmap.height

    // The largest centered 4:5 box that fits inside the source image —
    // crop the wider dimension down, keep the other at the source's own
    // full size.
    let cropWidth: number
    let cropHeight: number
    if (sourceRatio > targetRatio) {
      cropHeight = bitmap.height
      cropWidth = Math.round(cropHeight * targetRatio)
    } else {
      cropWidth = bitmap.width
      cropHeight = Math.round(cropWidth / targetRatio)
    }

    if (cropWidth < POST_MIN_WIDTH || cropHeight < POST_MIN_HEIGHT) throw new PostImageError("too_small")

    const sx = Math.round((bitmap.width - cropWidth) / 2)
    const sy = Math.round((bitmap.height - cropHeight) / 2)

    const scale = Math.min(1, POST_TARGET_WIDTH / cropWidth)
    const outputWidth = Math.round(cropWidth * scale)
    const outputHeight = Math.round(cropHeight * scale)

    const canvas = document.createElement("canvas")
    canvas.width = outputWidth
    canvas.height = outputHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new PostImageError("unsupported")
    ctx.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight)

    return canvas.toDataURL("image/webp", quality)
  } finally {
    bitmap.close()
  }
}
