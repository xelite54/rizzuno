/** Optional operator-approved adapter. Rizzuno's current gate is self-attestation.
 * No provider is enabled by default and no identity documents are accepted here. */
export interface AgeAssuranceProvider {
  name: string
  begin(input: { accountReference: string; minimumAge: number }): Promise<{ redirectUrl: string; transactionId: string }>
  // Adapter verifies the provider signature and binds the transaction to the
  // initiating account; client assertions must never be used as proof.
  verifyCallback(payload: Uint8Array, signature: string): Promise<{ transactionId: string; meetsMinimumAge: boolean; expiresAt: number }>
}
let provider: AgeAssuranceProvider | null = null
export function configureAgeAssurance(next: AgeAssuranceProvider | null) { provider = next }
export function ageAssuranceCapability() { return { state: provider ? "configured" : "not configured", provider: provider?.name ?? null, currentGate: "self_attestation" } }
