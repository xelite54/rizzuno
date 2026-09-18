import type { CategoryScore } from "./types"

/** A specialist signal must never be inferred from generic nudity confidence. */
export type SevereFinding = {
  kind: "known_hash_match" | "suspected_illegal_exploitation"
  providerReference: string
  escalationReason: string
}
export interface SevereContentProvider {
  name: string
  version: string
  check(bytes: Buffer): Promise<SevereFinding | null>
}
let specialized: SevereContentProvider | null = null
/** Only a reviewed server-side adapter may register; no fake default detector. */
export function configureSevereContentProvider(provider: SevereContentProvider | null) { specialized = provider }
export function severeContentCapability() {
  return { configured: specialized !== null, provider: specialized?.name ?? null, version: specialized?.version ?? "disabled" }
}
export async function checkSevereContent(bytes: Buffer): Promise<CategoryScore[]> {
  if (!specialized) return [] // Not checked, never represented as checked/clean.
  const finding = await specialized.check(bytes)
  // Throwing propagates to the caller's fail-closed path. No image copying,
  // no automatic external report, and no interpretation of generic scores.
  if (!finding) return []
  if (!["known_hash_match", "suspected_illegal_exploitation"].includes(finding.kind)
    || !finding.providerReference || !finding.escalationReason) throw new Error("invalid_specialized_result")
  return [{ category: "csam_suspected", score: 1 }]
}
