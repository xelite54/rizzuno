/** Paid charging stays disabled until a separately reviewed integration is enabled. */
export function billingMode(): "free_test" {
  const mode = process.env.BILLING_MODE ?? "free_test"
  if (mode !== "free_test") throw new Error("BILLING_MODE unsupported: paid billing requires a release review")
  return mode
}
