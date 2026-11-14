# Geographic availability and individual jurisdiction review

Updated November 14, 2026. This documents Rizzuno's product policy and technical controls, not a legal opinion or completed review.

## Eight default exclusions

`EXCLUDED_COUNTRIES` in `lib/geographicAccess.ts` is the canonical list: North Korea (KP), Iran (IR), Cuba (CU), Syria (SY), Russia (RU), Belarus (BY), China (CN), and Australia (AU). These are conservative product-policy defaults, not determinations that each country definitively prohibits this service. Configuration, an age declaration, an existing account, and launch-readiness overrides cannot enable them.

`COUNTRIES_ELIGIBLE_FOR_REVIEW` is derived from every recognized country/territory code except those eight exclusions: 242 locations, including the existing XK extension. It is not an activation list. All remain pending without their own approval. The 44 former exclusions are no longer a special subset in code or reporting. The complete current inventory is in [INTERNATIONAL_ACCESS_2026-11-14.md](INTERNATIONAL_ACCESS_2026-11-14.md).

## Central policy and configuration

`lib/countryPolicy.ts` resolves a location's single canonical decision. It exposes country code, jurisdiction, availability (`blocked`, `pending_review`, or `approved`), minimum age, assurance method, applicable subdivision list, legal review reference, and review deadline. `lib/agePolicy.ts` consumes that decision for both web access and signed realtime admission.

The three existing configuration inputs remain:

- `SUPPORTED_COUNTRIES`: explicitly activated uppercase country codes. Empty denies product access; excluded/invalid entries invalidate the allowlist.
- `SUPPORTED_SUBDIVISIONS_JSON`: country to approved subdivision-component arrays. A configured country requires an identified, allowlisted subdivision; an empty list denies the country. Each subdivision needs its own review.
- `AGE_POLICIES_JSON`: country or `COUNTRY-SUBDIVISION` review records. Each record uses `status`, `minimumAge`, `mode`, `reference`, and `reviewBy`.

Only `status: "approved"`, a valid age of at least 18 (or a higher applicable product/review threshold), supported assurance mode, non-empty evidence reference, and valid future `YYYY-MM-DD` deadline can pass. `blocked`, `pending_review`, missing status, missing/invalid reviews, `mode: "unavailable"`, and expired reviews deny access. Legacy records do not automatically become approved: migrating a record requires an actual review and explicit status. No real approval records or production activation values are shipped here.

Self-attestation is permitted only where the review supports that method for this service. `mode: "provider"` requires the existing authenticated assurance bridge flow; a checkbox cannot satisfy it. Launch validation rejects incomplete provider configuration. Configuration alone does not prove provider suitability or legal compliance. See [AGE_ASSURANCE.md](AGE_ASSURANCE.md).

## U.S. states and other subdivisions

U.S. activation always requires a non-empty reviewed state list in `SUPPORTED_US_REGIONS` and/or `SUPPORTED_SUBDIVISIONS_JSON.US`. When both are present, their intersection applies; neither can widen the other. Only recognized U.S. state/DC codes pass. A national `US` review cannot substitute for `US-NY`, `US-TX`, or another state's own approval. Missing/unapproved states deny access. Existing conservative age floors (21 for MS, 19 for AL/NE, otherwise at least 18) remain product safeguards, not legal findings or state approvals.

Other countries can also require subdivision-specific approvals. A national record cannot replace a scoped record, and scoped records without a matching subdivision allowlist fail closed. The operator's review must determine the correct national/subnational scope before activation.

## Enforcement and trust boundary

Next.js Proxy checks the current policy before product pages, APIs, and OAuth initiation/callback. Eligibility, assurance, and realtime-ticket handlers check it independently. Unknown/pending/blocked locations receive HTTP 451 with `region_unavailable` and non-cacheable headers. Responses include a stable reason and public explanation distinguishing pending review, expired review, permanent exclusion, unverified location, invalid configuration and pending activation. Private review references never appear in those responses. Public legal, designated safety, appeal and recent-report pages, Auth.js sign-out/CSRF, framework assets, and the signature-protected billing webhook retain their narrow existing exceptions. Those exceptions cannot issue product access or a realtime ticket.

Web geolocation requires both actual Vercel hosting (`VERCEL=1`) and the reviewed adapter selection (`LAUNCH_GEO_SOURCE=vercel`). Only Vercel's IP-derived country and subdivision headers are read. Browser fields, query strings, generic forwarded country headers, and locale do not select a jurisdiction. Standalone hosting cannot make its incoming headers trusted by themselves. Never manually mark an untrusted host as Vercel. See Vercel's [header documentation](https://vercel.com/docs/headers/request-headers).

The web issuer signs account, country, subdivision, age-policy hash and expiry into version-2 realtime tickets. Cluster gateways and WebSocket admission verify the signature and current policy; direct hello location fields and forwarded headers are not proof. Current approval is rechecked for live access, matching, and invitations alongside legal acceptance, bans, restrictions and suspension. Changing a policy's age, method, evidence or deadline changes its hash; withdrawing approval prevents continued admission, including use of an otherwise valid old age cookie or ticket. Terms version 2026-11-13 requires fresh account acceptance without deleting historical records.

IP geolocation is not residence verification or guaranteed VPN/proxy detection. Local tests prove application decisions, not Vercel's live ingress sanitization. Before rollout, verify the actual ingress and any upstream proxy on a permitted network. Keep signing secrets private and the same reviewed policy configuration on web, realtime gateways, and workers. No geographic or age setting is public proof of another participant's age.

## Operational review and activation

Run `npm run policy:countries` to inspect the current process environment's resolved country/subdivision metadata. It reports approved policy locations; it does not discover production configuration, approve a jurisdiction, or certify launch readiness. It reads no cloud credentials and changes nothing. An unconfigured process reports zero approvals.

For each intended jurisdiction, obtain and retain scoped legal/privacy/safety evidence; decide the minimum age, adequate assurance method, subdivisions, review reference and deadline; configure only that approval on both services; test the real assurance provider where required; validate launch readiness and trusted ingress; and obtain the normal release approval. `SKIP_LAUNCH_READINESS=true` is rejected by production validation. The CI compile exception requires Next's build phase; copying its environment flags cannot pass runtime startup or `launch:check`. Leave every unreviewed jurisdiction pending. Existing operator, moderation, reporting, retention, child-safety and suspension requirements remain in force.

Use the deliberately inactive [configuration templates](../config/README.md). `npm run policy:compare -- <web-policy.json> <realtime-policy.json>` checks operator-exported non-secret policy settings for equivalence without printing review references. Run `launch:check` separately on both real environments; equality alone never establishes approval or readiness.

No production environment, provider, country approval or deployment is changed by this branch. The production build check uses the existing isolated compile fixture with readiness skipping explicitly false and operator approval flags false. That artifact is not suitable for deployment and grants no runtime jurisdiction approval.
