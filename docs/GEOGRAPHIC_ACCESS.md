# Geographic product access

Updated November 1, 2026. This is a product availability policy, not a finding that the excluded countries have identical laws or that any remaining country is legally compliant. No real jurisdiction approval or deployment configuration is created by this change.

## Mandatory exclusions

The canonical list is `EXCLUDED_COUNTRIES` in `lib/geographicAccess.ts`. All 52 countries are denied even if mistakenly included in configuration, supplied with a current age declaration, or used with `SKIP_LAUNCH_READINESS=true`:

```text
KP IR CU RU BY SY GB AU BR ID MY TR AE US
AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE
IS LI NO CH CA NZ IN CN KR SG PH
```

`SUPPORTED_COUNTRIES` remains an explicit uppercase allowlist. Its parser rejects excluded/invalid entries rather than silently treating the rest of the world as approved. An empty list denies product access; launch validation requires a non-empty, valid list. A list containing an excluded country is invalid and denies access until corrected. Neither development mode, the compile-only fixture nor the readiness override bypasses runtime geographic checks.

Every enabled country also needs a documented, unexpired `AGE_POLICIES_JSON` decision, as described in [AGE_ASSURANCE.md](AGE_ASSURANCE.md). Checkbox-only access requires `mode: "self_attestation"` backed by the operator's scoped legal review. Missing decisions and `mode: "unavailable"` deny access; provider checks apply only where the review actually requires them. No additional provider is enabled by this exclusion change. Countries outside the excluded list are not automatically added to either configuration.

## Separate subdivision restrictions

Use `SUPPORTED_SUBDIVISIONS_JSON` for subnational restrictions, independently of country eligibility. A configured country is restricted to the listed subdivision components from Vercel's ISO 3166-2 header. Missing, malformed or unapproved subdivisions are denied. An empty subdivision list denies that whole country.

Each listed subdivision needs its own `COUNTRY-SUBDIVISION` age-policy entry; a national entry cannot substitute. Subdivision policy entries without a matching subdivision allowlist also fail closed. When no subdivision restriction applies, an explicit reviewed national policy is still required. Configuration syntax alone is not evidence that national approval is legally sufficient; the review must determine whether subnational restrictions are needed.

For syntax illustration only, `{"XX":["01"]}` would require an `XX-01` policy. `XX` is not a valid country: replace it only with an actual approved country and reviewed region. Do not copy a test fixture as a real legal approval. `SUPPORTED_US_REGIONS` is retained as an inactive compatibility setting and must remain empty: US is excluded nationwide and no state entry overrides that decision.

## Trust boundary and enforcement

The web app reads only Vercel's `x-vercel-ip-country` and `x-vercel-ip-country-region` headers when running on the actual Vercel platform (`VERCEL=1`). Country/subdivision query parameters, request bodies, browser geolocation, locale and generic forwarded headers do not grant access. Standalone deployments return an unidentified location; manually setting `VERCEL=1` on an untrusted host is not an approved geolocation adapter.

Vercel documents these signals in its [request-header reference](https://vercel.com/docs/headers/request-headers) and [geolocation guidance](https://vercel.com/kb/guide/geo-ip-headers-geolocation-vercel-functions). Keep the web ingress behind Vercel and review any upstream proxy. Test forged geolocation headers against the deployed edge before release; synthetic local headers test application decisions, not Vercel's actual edge sanitization.

Next.js Proxy rejects blocked product pages, API requests, Google OAuth initiation/callback and authentication endpoints before route execution. Denied navigation shows **Rizzuno is unavailable in your region** in a responsive page with legal/safety links. Denied APIs return HTTP 451 with `region_unavailable`, the same message and non-cacheable headers. Eligibility and realtime-ticket handlers also enforce policy themselves. Requesting an API directly does not grant a browser age session or a realtime ticket.

The existing narrow exceptions remain: public legal/designated safety, appeal and recent-report pages; framework static/image assets; and the billing webhook, which requires its own provider signature and does not issue product access. The exact Auth.js sign-out and CSRF endpoints also remain reachable so an existing user can sign out; they do not enable sign-in or expose the session endpoint. Safety pages and existing account/report authorization checks remain intact. These exceptions do not permit sign-in, chat or matchmaking in an excluded location. An in-app geographic rejection stops matching and displays the same availability message instead of requesting another age declaration.

Realtime keeps the current Railway/WebSocket architecture. The trusted web issuer signs a version-2 ticket containing country, available subdivision, account reference, age-policy hash and eligibility expiry. Both the cluster gateway and matchmaking engine verify the ticket; client-supplied hello location fields and Railway-forwarded geographic headers are not used as location proof. The shared verifier rechecks exclusions, allowlist, subdivision, current age policy and expiry. Empty allowlists, malformed/legacy tickets, removed approvals and old policy hashes deny admission. Existing live-access sweeps and final matchmaking/invitation checks also recheck the policy, alongside bans, restrictions and legal acceptance.

A ticket attests the location observed at issuance, not a fresh independent geolocation measurement of each WebSocket frame. IP geolocation is not residency verification and cannot guarantee detection of VPNs, relays, copied bearer credentials or a network change after issuance. Use HTTPS, short-lived tickets, consistent configuration and normal signing-key controls. Do not claim these local tests prove resistance to every network-routing bypass.

## Release and verification

Deploy the same source revision and geographic/age-policy configuration to web, cluster gateways and realtime workers. Ticket wire version 2 deliberately invalidates old wire-format tickets; refresh/reconnect uses the existing authenticated ticket endpoint. Roll out consistently and drain old workers/connections when narrowing access; changing web environment values alone does not reconfigure a running Railway process.

No production allowlist is invented here. Complete scoped national/subnational legal reviews, set only approved allowlist and age-policy entries, and validate real Vercel ingress before enabling access. Existing child-safety reporting, banning, privacy handling and appeals remain necessary even where product access is excluded.

Automated coverage checks the exact 52-code set, configuration/override failures, unknown and unapproved locations, subdivision isolation, blocked API/OAuth routes despite a valid age cookie, direct eligibility/ticket denial, authentic-but-excluded and malformed WebSocket tickets, policy revocation, and successful approved-fixture matchmaking with existing safety tests. Test jurisdictions are synthetic fixtures, not country legal determinations.
