/**
 * The extension point for suspected child sexual abuse material — kept
 * completely separate from the general nudity/explicit-sexual detector in
 * provider.ts on purpose. Ordinary NSFW classifiers score how explicit an
 * image looks; they were never built or validated to distinguish CSAM from
 * adult content, and treating "very high nudity/explicit-sexual
 * confidence" as a CSAM signal would be exactly the "homemade illegal-
 * content identification based solely on generic nudity-confidence
 * thresholds" this pipeline must not do.
 *
 * A real deployment handles this category via a SEPARATE, specialized
 * pathway — typically a known-hash matching service (e.g. a PhotoDNA-
 * compatible provider, or Thorn's Safer) that Rizzuno would need an actual
 * vendor relationship (and, depending on jurisdiction, its own legal/
 * reporting process — e.g. NCMEC CyberTipline reporting in the US) for.
 * NONE of that exists in this codebase or this environment — there is no
 * hash-matching provider configured, and this function is a deliberate
 * no-op stub, never a homemade substitute for one.
 *
 * checkSevereContent() is still called on every image (see index.ts), so
 * the moment a real provider IS wired in here, csam_suspected starts
 * flowing into policy.ts's decision (see its own doc comment: any nonzero
 * signal forces BLOCK, no threshold, no "review" middle ground) without
 * any other file needing to change.
 */

import type { CategoryScore } from "./types"

export async function checkSevereContent(_bytes: Buffer): Promise<CategoryScore[]> {
  // No specialized provider configured — see this file's own doc comment.
  // Deliberately returns an empty list rather than fabricating a score;
  // an empty list contributes nothing to policy.ts's decision, which is
  // the correct behavior for "not checked", not "checked and clean".
  return []
}
