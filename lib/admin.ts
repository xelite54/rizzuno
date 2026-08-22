/**
 * There's no roles/permissions table (or any table of humans at all — see
 * lib/db.ts). Admin access is granted by listing trusted Google account
 * emails in an env var — simple, but it's a real server-side authorization
 * check on every admin route/page, not a client-trusted flag.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}
