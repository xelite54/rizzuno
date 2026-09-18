/** Server-side allowlist for verified Google account emails. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}
