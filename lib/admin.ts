/** Server-side allowlist for verified Google account emails. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}

/** Separate appointment/training allowlist; being an admin alone is insufficient. */
export function isSafetyReviewer(email: string | null | undefined): boolean {
  return isAdminEmail(email) && (process.env.SAFETY_REVIEWER_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(email!.toLowerCase())
}
