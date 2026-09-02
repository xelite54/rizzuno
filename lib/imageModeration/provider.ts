import type { CategoryScore } from "./types"
import { SightengineProvider } from "./sightengineProvider"

/**
 * The DETECTOR half of "the external provider is the DETECTOR, Rizzuno's
 * own policy engine is the DECISION MAKER" (see policy.ts) — this file
 * only ever selects/exposes a provider that produces category scores; it
 * never decides allow/review/block itself. The interface below is what
 * keeps a real vendor swappable behind one seam — see
 * sightengineProvider.ts (the current real implementation) for how a
 * specific vendor's own response shape gets mapped into Rizzuno's
 * internal category vocabulary.
 */

export type ProviderAnalysis = {
  categories: CategoryScore[]
  /** Vendor's own id for this specific analysis, if it returns one — stored in moderation_events for support/audit purposes, never shown to the uploader. */
  providerReference: string | null
}

export type ProviderOutcome =
  | { ok: true; analysis: ProviderAnalysis }
  | { ok: false; reason: "unconfigured" | "timeout" | "error" | "malformed_response" }

export interface ModerationProvider {
  readonly name: string
  /** Part of the moderation cache's key (see policy.ts's POLICY_VERSION and lib/db.ts's getCachedModerationDecision) so a mapping/model change can't silently reuse a decision scored under the old one — see each implementation's own doc comment for what this actually tracks. */
  readonly modelVersion: string
  analyze(bytes: Buffer, format: string): Promise<ProviderOutcome>
}

/** Always reports "unconfigured" — never silently treated as "nothing to flag" (see index.ts, which fails closed on this exact outcome). This is what a fresh checkout / an environment with no SIGHTENGINE_API_USER + SIGHTENGINE_API_SECRET configured gets by default; images cannot be approved without real provider credentials actually configured. */
class UnconfiguredProvider implements ModerationProvider {
  readonly name = "unconfigured"
  readonly modelVersion = "none"
  async analyze(): Promise<ProviderOutcome> {
    return { ok: false, reason: "unconfigured" }
  }
}

let cachedProvider: ModerationProvider | null = null

/**
 * Selects Sightengine if SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET
 * are both set, otherwise the always-unavailable one — resolved once and
 * reused (the env doesn't change mid-process). Called identically from
 * both processes this repo runs as (the Vercel-deployed Next.js app's
 * route handlers, and the Railway-deployed realtime server's
 * server/ws-server.ts "chat" image handler) — both need the same two env
 * vars set in their own deployment's environment configuration, the same
 * way DATABASE_URL/REALTIME_TICKET_SECRET already must be (see
 * .env.example); there is no code-level difference between the two
 * processes here, only a configuration one.
 */
export function getConfiguredProvider(): ModerationProvider {
  if (cachedProvider) return cachedProvider
  const apiUser = process.env.SIGHTENGINE_API_USER
  const apiSecret = process.env.SIGHTENGINE_API_SECRET
  cachedProvider = apiUser && apiSecret ? new SightengineProvider(apiUser, apiSecret) : new UnconfiguredProvider()
  return cachedProvider
}

/** Test-only seam — tests inject a fake provider instead of reaching for a real network call. Never used outside tests. */
export function setProviderForTesting(provider: ModerationProvider | null) {
  cachedProvider = provider
}
