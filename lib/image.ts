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
