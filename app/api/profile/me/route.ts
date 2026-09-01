import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getPublicProfile, updateOwnProfile, getUserStatus, describeDbError } from "@/lib/db"
import { isRateLimited } from "@/lib/apiRateLimit"
import { moderateImage } from "@/lib/imageModeration"

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
 * doc comment). hooks/useMyProfile.ts always sends exactly ONE of these
 * per request (profilePhoto via its own explicit, moderation-aware
 * updateProfilePhoto() action; bio via its background auto-sync effect) —
 * deliberately never bundled, so a photo rejection can never also block an
 * unrelated bio edit sent in the same request, and vice versa.
 *
 * A new `profilePhoto` value goes through moderateImage() (surface:
 * "profile_photo") BEFORE updateOwnProfile() is ever called with it — on
 * anything but "allow", updateOwnProfile() never runs for this field at
 * all, so the existing photo already in the database is simply never
 * touched (see moderateImage's own doc comment on why "review" is treated
 * as a rejection the same as "block" — there's no human-review queue for
 * this to sit in yet). `profilePhoto: null` (explicitly removing a photo)
 * skips moderation entirely — there's nothing to check when nothing new
 * is being uploaded.
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
    } else if (typeof body.profilePhoto === "string") {
      const moderation = await moderateImage({ userId, dataUrl: body.profilePhoto, surface: "profile_photo" })
      if (moderation.decision !== "allow") {
        // Never applied, and nothing else in this request (bio isn't sent
        // alongside a photo update — see this function's own doc comment)
        // gets touched either — the existing photo stays exactly as it
        // was. Generic, user-safe response only — see moderateImage's own
        // doc comment on why no category/score/provider detail is ever
        // returned here.
        return NextResponse.json(
          { error: moderation.unavailable ? "moderation_unavailable" : "moderation_blocked" },
          { status: moderation.unavailable ? 503 : 422 }
        )
      }
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
