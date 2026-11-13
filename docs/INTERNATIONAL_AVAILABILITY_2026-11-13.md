# International availability implementation — 2026-11-13

The implementation is ready for individual jurisdiction review. It does not authorize public launch in any new country, certify legal compliance, or reproduce OmeTV's exact country restrictions.

## Eight default exclusions

North Korea (KP), Iran (IR), Cuba (CU), Syria (SY), Russia (RU), Belarus (BY), China (CN), and Australia (AU). These are conservative product-policy defaults; they are not definitive findings that each country legally prohibits Rizzuno. Neither configuration nor an age declaration can override this default exclusion list.

## Countries eligible for review

The following 44 countries were removed from the former 52-country default list. They are technically configurable and remain pending without explicit, supported approval. The statuses below describe the branch's unconfigured defaults, not an assertion that a legal review has taken place.

| Code | Country | Default status |
| --- | --- | --- |
| AE | United Arab Emirates | pending_review |
| AT | Austria | pending_review |
| BE | Belgium | pending_review |
| BG | Bulgaria | pending_review |
| BR | Brazil | pending_review |
| CA | Canada | pending_review |
| CH | Switzerland | pending_review |
| CY | Cyprus | pending_review |
| CZ | Czechia | pending_review |
| DE | Germany | pending_review |
| DK | Denmark | pending_review |
| EE | Estonia | pending_review |
| ES | Spain | pending_review |
| FI | Finland | pending_review |
| FR | France | pending_review |
| GB | United Kingdom | pending_review |
| GR | Greece | pending_review |
| HR | Croatia | pending_review |
| HU | Hungary | pending_review |
| ID | Indonesia | pending_review |
| IE | Ireland | pending_review |
| IN | India | pending_review |
| IS | Iceland | pending_review |
| IT | Italy | pending_review |
| KR | South Korea | pending_review |
| LI | Liechtenstein | pending_review |
| LT | Lithuania | pending_review |
| LU | Luxembourg | pending_review |
| LV | Latvia | pending_review |
| MT | Malta | pending_review |
| MY | Malaysia | pending_review |
| NL | Netherlands | pending_review |
| NO | Norway | pending_review |
| NZ | New Zealand | pending_review |
| PH | Philippines | pending_review |
| PL | Poland | pending_review |
| PT | Portugal | pending_review |
| RO | Romania | pending_review |
| SE | Sweden | pending_review |
| SG | Singapore | pending_review |
| SI | Slovenia | pending_review |
| SK | Slovakia | pending_review |
| TR | Türkiye | pending_review |
| US | United States | pending_review |

## Actual activation

- Newly activated countries: **none**.
- Production configuration changes and deployments: **none**.
- Repository configuration template and current unconfigured process: **zero approved locations**, verified using the new read-only policy report.
- The existing local .env.local and .env.production.local files contain no SUPPORTED_COUNTRIES, subdivision activation, or AGE_POLICIES_JSON review entries. Their secret values were not printed or changed.
- Live web deployment activation settings were not inventoried in this task; the branch does not modify or certify the production enabled-country list.
- Synthetic Japanese and U.S./international approvals exist only inside tests. The compile-only build fixture is not an approval or a deployable production artifact.

Removing a country from the default exclusion list never activates it. An operator must separately include it in SUPPORTED_COUNTRIES and provide an explicitly approved, current AGE_POLICIES_JSON record for the exact jurisdiction. Existing records without the new status field are pending and require reviewed migration. No records are automatically upgraded to approved.

## Controls and migration

The centralized resolver in lib/countryPolicy.ts exposes country, jurisdiction, blocked/pending_review/approved status, minimum age, assurance method, subdivision restrictions, legal review reference, and review deadline. The existing geographic and age configuration inputs remain in place; no duplicate approval configuration source was introduced. See [GEOGRAPHIC_ACCESS.md](GEOGRAPHIC_ACCESS.md) and [AGE_ASSURANCE.md](AGE_ASSURANCE.md).

U.S. access requires a non-empty state allowlist. SUPPORTED_US_REGIONS and SUPPORTED_SUBDIVISIONS_JSON.US intersect when both are supplied. State-specific reviews are mandatory; national approval cannot replace them. The existing 18+ minimum, higher conservative state/product floors, provider verification, policy hashes, signed eligibility cookies, and short-lived signed realtime location tickets remain enforced. Pending and expired reviews invalidate access even with an otherwise authentic old cookie or ticket.

Both actual Vercel hosting and LAUNCH_GEO_SOURCE=vercel are required before platform location headers are accepted. Client fields and generic forwarded country headers do not select policy. Real WebSocket tests reject authentic old tickets after approval withdrawal despite forged location headers and hello fields. Live gateway/engine access checks continue to apply policy, legal acceptance, moderation restrictions, bans and suspensions.

Terms version 2026-11-13 describes the updated product defaults and requires fresh acceptance through the existing account gate; historical acceptance records are retained. No privacy, reporting, child-safety, moderation or account-suspension system was removed or relaxed.

## Remaining legal and operational requirements

1. Retain actual scoped legal/privacy/safety evidence for each intended country and subdivision. Decide the minimum age, acceptable assurance method, restrictions, case reference, and review deadline. Leave every unreviewed location pending.
2. Validate a real provider's method, authentication, binding, accuracy, privacy/deletion, retention, and failure behavior wherever self-attestation is insufficient. Provider-mode launch validation requires complete bridge configuration; a checkbox cannot replace provider eligibility.
3. Complete the existing operator, safety, moderation staffing, reporting, retention, and U.S.-specific launch decisions where applicable. No checklist or test fixture supplies these approvals.
4. Migrate only evidenced review records to explicit approved status. Apply matching country/state/age settings and the same source revision to web, gateways and realtime workers. Review and obtain release approval before deployment.
5. Verify real Vercel ingress header handling and any upstream proxy before rollout. Local tests establish application decisions, not resistance to every VPN, proxy, copied bearer credential or post-issuance network change.
6. Re-review before deadlines and when applicable rules or service features change. Do not use SKIP_LAUNCH_READINESS as a substitute for approval.

## Executed checks

Environment: Node 24.15.0, npm 11.12.1, macOS arm64, Chrome 157.0.8103.52, temporary Redis 8.10.2.

| Check | Result |
| --- | --- |
| npm ci | Passed; clean install, 0 vulnerabilities |
| npm run lint | Passed; no warnings or errors |
| npm run typecheck | Passed for application, tests, and browser harness |
| npm test | 353 passed, 0 failed, 0 skipped or cancelled |
| npm run test:cluster | Passed; real Redis cross-process matching, coordinator failover, fencing, replacement and reconnect |
| npm run test:postviewer:browser | Passed on desktop/mobile galleries and profile sheets |
| npm run test:profiles:browser | Passed for all six profile entry points and profile actions |
| npm run test:webrtc:browser | Passed; 120238 ms bidirectional call and 24 samples; media controls, chat, recovery, random/direct calls, legal gate and sign-out |
| npm run test:homepage:browser | Passed; 181217 ms; persistent controls, responsive layouts, declaration/Google continuation, regional denial and safety links |
| npm run test:homepage:runtime | Passed; 181973 ms; real hooks/HTTP/WebSocket/WebRTC, reconnect, legal acceptance, camera recovery, matching and geographic denial |
| node scripts/ci-build.mjs | Passed; runs npm run build with the isolated compile fixture; SKIP_LAUNCH_READINESS explicitly false and operator approval flags false |
| npm audit --audit-level=high | Passed; 0 vulnerabilities |
| npm run policy:countries | Passed; eight exclusions, 44 review candidates, no approved locations in current process |
| git diff --check | Passed |

New access coverage includes all eight exclusions, each of the 44 review candidates independently pending/approved, missing status, blocked status, expired/invalid reviews, higher minimum ages, provider versus checkbox proofs, U.S. state intersections and revocation, direct WebSocket/header spoofing, OAuth/ticket issuance, and existing U.S. operator/safety startup controls. Existing moderation/authentication tests remain green.

The browser runs use real Chromium and WebRTC with synthetic capture/account/database fixtures. They do not constitute physical-device, Google-account, live-provider, production TURN, live Vercel ingress, or public launch acceptance. No production deployment occurred.
