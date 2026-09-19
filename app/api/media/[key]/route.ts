import { withHttpMetrics } from "@/lib/httpMetrics"
import { auth } from "@/auth"
import { getUserStatus, isStoredImageReferenced } from "@/lib/db"
import { isImageKey, readStoredImage } from "@/lib/imageStorage"
import { log } from "@/lib/observability"

async function handleGET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return new Response(null, { status: 401 })
  const { key } = await context.params
  if (!isImageKey(key)) return new Response(null, { status: 404 })
  try {
    const status = await getUserStatus(session.user.id)
    if (status.banned || status.deleted || status.suspendedUntil && status.suspendedUntil > Date.now()) return new Response(null, { status: 403 })
    if (!await isStoredImageReferenced(`/api/media/${key}`)) return new Response(null, { status: 404 })
    const bytes = await readStoredImage(key)
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
    } })
  } catch { log.error("image.storage_unavailable"); return new Response(null, { status: 503 }) }
}

export const GET = withHttpMetrics("/app/api/media/[key]", handleGET)
