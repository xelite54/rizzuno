import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getPublicProfile, updateOwnProfile, getUserStatus, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"

// Same cap chat images already use (lib/signaling/protocol.ts's
// MAX_CHAT_IMAGE_LENGTH) and the same data-URL shape server/ws-server.ts's
// own DATA_URL_IMAGE_PATTERN already validates chat images against —
// duplicated locally rather than shared, matching how ws-server.ts already
// defines its own copy rather than importing one.
const MAX_PROFILE_IMAGE_LENGTH = 2_000_000
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i
const MAX_BIO_LENGTH = 200

/**
 * The authenticated account's own full profile — username plus the fields
 * migration 0005 moved server-side (profilePhoto/bio/posts). Used by
 * hooks/useMyProfile.ts to hydrate from the server (the actual source of
 * truth now) rather than trusting only whatever this browser's own
 * localStorage cache happens to have.
 */
export async function GET() {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("profile/me: auth() threw on GET — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  try {
    const profile = await getPublicProfile(userId)
    return NextResponse.json(profile)
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/me: GET failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}

/**
 * Updates the caller's own profilePhoto and/or bio — the fields present in
 * the request body are the only ones touched (see updateOwnProfile's own
 * doc comment). This is what makes hooks/useMyProfile.ts's editor actually
 * persist server-side instead of only ever writing to this one browser's
 * localStorage.
 */
export async function PUT(request: Request) {
  let session
  try {
    session = await auth()
  } catch (err) {
    console.error("profile/me: auth() threw on PUT — returning 500", describeDbError(err))
    return NextResponse.json({ error: "auth_error" }, { status: 500 })
  }

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  if (isRateLimited(`profile-update:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  let body: { profilePhoto?: unknown; bio?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const updates: { profilePhoto?: string | null; bio?: string } = {}

  if ("profilePhoto" in body) {
    if (body.profilePhoto === null) {
      updates.profilePhoto = null
    } else if (
      typeof body.profilePhoto === "string" &&
      body.profilePhoto.length <= MAX_PROFILE_IMAGE_LENGTH &&
      DATA_URL_IMAGE_PATTERN.test(body.profilePhoto)
    ) {
      updates.profilePhoto = body.profilePhoto
    } else {
      return NextResponse.json({ error: "invalid_photo" }, { status: 400 })
    }
  }

  if ("bio" in body) {
    if (typeof body.bio !== "string") {
      return NextResponse.json({ error: "invalid_bio" }, { status: 400 })
    }
    updates.bio = body.bio.slice(0, MAX_BIO_LENGTH)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const status = await getUserStatus(userId)
    if (status.banned || status.deleted) {
      return NextResponse.json({ error: "account_unavailable" }, { status: 403 })
    }
    await updateOwnProfile(userId, updates)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const details = describeDbError(err)
    console.error("profile/me: PUT failed", { userId, ...details })
    return NextResponse.json({ error: "database_error", code: details.code ?? null }, { status: 500 })
  }
}
