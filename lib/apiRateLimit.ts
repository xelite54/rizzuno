import { checkAndIncrementApiRateLimit } from "./db"

/** Shared atomic fixed window. An unavailable store denies the operation. */
export async function isRateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
  try { return await checkAndIncrementApiRateLimit(key, limit, windowMs) }
  catch { return true }
}
