# International access implementation and production inspection — November 14, 2026

The owner confirmed that country/state legal approvals, age-assurance reviews and final production release approval are incomplete. This change implements configurable international access; it does not activate a jurisdiction or authorize a release. All 242 recognized locations outside the permanent exclusions remain pending review.

## Permanent exclusions and activation

North Korea (KP), Iran (IR), Cuba (CU), Syria (SY), Russia (RU), Belarus (BY), China (CN), and Australia (AU) are permanently excluded by product policy. These are the only permanent country exclusions. An allowlist, review record, age cookie, signed realtime ticket, readiness flag, forwarded header or client location claim cannot override a resolved excluded country.

**Countries activated by this change: none.** No production environment settings, secrets, approval records, deployments or routing settings were changed. No record was migrated automatically to approved. Test approvals are synthetic fixtures only.

Every other recognized location is individually configurable, including South Korea, the United States, Canada, the United Kingdom, European countries, Japan, India and Brazil. Recognition does not determine the required age, assurance method or legal permissibility. The inventory includes ISO territories and the existing XK extension as well as countries.

## Implementation

- The review inventory now derives from all 250 recognized codes rather than a historical list of 44 former exclusions. Exactly eight are excluded and 242 are eligible for review.
- The shared country policy drives web pages, authentication admission, age eligibility, realtime tickets, WebSocket admission and matchmaking. Existing exact-jurisdiction approvals, 18+ and higher configured ages, provider verification, policy hashes and approval expiry/revocation remain enforced.
- HTTP 451 responses explain pending review, expired review, permanent exclusion, unknown country/subdivision, incomplete configuration and pending activation. Private review references are not disclosed.
- Production rejects `SKIP_LAUNCH_READINESS=true`. The synthetic CI exception requires an explicit build-phase option; copying its environment flags cannot authorize either runtime service or pass `launch:check`.
- Inactive configuration and pending-review templates are in [config/README.md](../config/README.md). They contain no invented approvals or secrets. `policy:compare` compares operator-exported policy settings, including effective subdivision intersections and every review field, without logging review records. Matching configuration does not establish approval.
- Existing U.S. state requirements remain: explicit state list, intersection when both lists are supplied, separate state approval, identified state, no national fallback, and the existing higher conservative state/product floors. Other countries retain configurable subdivision requirements.
- Existing reporting, moderation, account bans, legal acceptance, privacy and child-safety enforcement remain in place.

## Actual production inspection

| Item | Observed status |
| --- | --- |
| GitHub main at inspection | `0cd5ad7d4e090db19382563face4d39e18a2fc2c` |
| Vercel public frontend | `https://rizzuno.com`; Vercel response headers; homepage, eligibility, auth session/sign-in and ticket probes returned 451 with `private, no-store`; Terms returned 200 |
| Vercel project configuration | Local link is `prj_JtAr7zT134hPqxiFmkopSqeqhRVg`, team `team_M9wfod9hfat8NtdUhR1iQgFH`; connector returns project-not-found even with explicit team scope, and lists no projects in that team. Actual environment values, function regions and deployment checks could not be verified through this connection. This is not proof the project is deleted. |
| Railway project/environment | `diligent-clarity`, project `9ec60ddf-9af7-4c4d-b949-1d46b0d8e4ec`, production `4b163709-0add-43d9-8370-44843a65c9a3` |
| Railway realtime | Service `b509bb68-fdc4-4bfb-a695-41482335a29a`, source `xelite54/rizzuno@main`, one replica in `us-west2` |
| Railway deployment | `514efb76-80f9-4061-9867-819b9487eb4c`, SUCCESS, created November 13, 2026. Existing main commit's GitHub deployment status links to this deployment. |
| Railway endpoints | `https://rizzuno-production.up.railway.app`; `/health` and `/ready` returned 200; direct website and ticket routes returned 451 |
| Live WebSocket probe | Actual `/rizzuno-ws` gateway closed with code 1008, reason `invalid ticket`, after an unauthenticated hello with forged Vercel country/subdivision headers and client country/eligibility fields. This confirms rejection of that probe, not live approved-account admission. |
| Railway geographic configuration | Variable-name inventory has no `SUPPORTED_COUNTRIES`, `SUPPORTED_US_REGIONS`, `SUPPORTED_SUBDIVISIONS_JSON`, `AGE_POLICIES_JSON` or `LAUNCH_GEO_SOURCE`. `SKIP_LAUNCH_READINESS` exists, but its value is redacted. OAuth connector supplies names only; no secrets were retrieved or changed. |
| Railway release/startup settings | `source.checkSuites=false` (wait-for-CI disabled), build `npm run build`, start `npm run start`, healthcheck `/health`; no staged changes |
| Redis/routing | Redis is one replica in `ams`, while realtime is in `us-west2`; public probes used Vercel ingress `icn1` and Railway edge `hnd1`. Edge routing is not a country approval. No service, database, volume or region was moved. |

Production policy equivalence cannot be certified: Railway lacks the policy settings, and Vercel settings are inaccessible through the connected account. The missing approvals independently prevent activation.

## Automated verification

Environment: Node 24.15.0, npm 11.12.1, macOS arm64, Chrome 157.0.8103.52, temporary local Redis.

| Check | Result |
| --- | --- |
| Full test suite | 358 passed, 0 failed, skipped or cancelled |
| Geographic matrix | Every one of the 242 reviewable locations tested pending and individually approved using synthetic decisions; homepage, OAuth admission, eligibility and ticket issuance checked; two real WebSocket clients admitted and matched for each location |
| Permanent exclusions/security | All eight denied despite allowlists, synthetic approval records, readiness flags, old cookies/tickets and forged header/hello claims; missing/unknown location, tampering, expired/revoked policy and U.S. state restrictions tested |
| Age assurance | Existing provider-bound results, provider-unavailable failures, browser challenge binding and rejection of checkbox substitution remain covered |
| Lint and TypeScript | Passed; application, tests and browser projects |
| Security audit | `npm audit --audit-level=high`: zero vulnerabilities |
| Production build | `node scripts/ci-build.mjs`: passed `npm run build` with isolated, non-deployable compile settings; readiness skipping false and operator approval flags false |
| Realtime cluster | Passed real Redis/multiple processes, cross-gateway matching, coordinator failover, fencing, replacement and Redis reconnect |
| Gallery/profile browsers | Passed desktop/mobile post viewer and all six profile entry points/actions |
| WebRTC browser | Passed 120228 ms bidirectional call with 24 samples; camera/microphone controls, sender association, chat, recovery, skip, direct call, legal rejection and sign-out |
| Homepage runtime browser | Passed 181652 ms with real hooks/HTTP/WebSocket/WebRTC; login fixture, profile hydration, reconnect/retries, restrictions, legal acceptance, camera recovery, matching and geographic denial |
| Homepage UI browser | Passed 180919 ms with 17438 frame/DOM samples; persistent controls, responsive layouts, eligibility/Google continuation, regional denial and legal links |
| Policy inventory/comparison | Eight permanent exclusions, 242 pending locations, no approvals; inactive template validates and compares; unit tests detect age/method/reference/deadline/status and geographic drift |

The browser runs use synthetic capture and account/database fixtures. They verify application behavior and OAuth gating, not a real Google account, certified assurance provider, physical-device media or production TURN allocation. Approved synthetic users proceed to the homepage without the regional-unavailable screen; no real production user or jurisdiction is represented as approved. Genuine network-location tests in enabled jurisdictions remain external acceptance work.

## Required before public activation

1. Obtain country and applicable state/subdivision legal/privacy/safety review. Record a real reference, scope, minimum age, adequate assurance method and review deadline. Keep every unsupported or unreviewed jurisdiction pending.
2. Provision and validate a suitable assurance provider wherever required. Document method suitability, authentication/binding, privacy, deletion/retention and failure behavior. A checkbox cannot replace required provider verification.
3. Complete actual operator, moderation staffing, reporting, child-safety, retention, provider-region and U.S. operational approvals as applicable. Obtain final production release approval.
4. Restore Vercel project access and inspect actual production environment, ingress/proxies, deployment checks and regions. Configure the five matching policy settings on both services using only documented approvals; validate actual provider configuration separately.
5. Enable Railway wait-for-CI and enforce the four required checks (`quality`, `security`, `realtime-integration`, `browser-webrtc`) for the exact release commit with appropriate GitHub protections and Vercel deployment checks. See [Railway's wait-for-CI documentation](https://docs.railway.com/deployments/github-autodeploys) and [PRODUCTION_WORKFLOW.md](PRODUCTION_WORKFLOW.md). This branch does not claim those external controls are enabled.
6. Run `policy:compare` and `launch:check` against the real deployment settings. Resolve the existing readiness bypass variable before a future deployment: the updated code rejects true and still requires all approvals if it is false or removed. Do not deploy CI output.
7. After approval and successful CI, deploy both services from the same revision, then verify actual Vercel [IP-derived country/subdivision headers](https://vercel.com/docs/headers/request-headers), approved/denied geographic networks, live Google login, real provider verification, authenticated tickets, direct WebSocket security, two-device WebRTC/TURN, matchmaking and safety workflows.

IP geolocation and signed bearer tickets cannot establish residence or guarantee detection of VPNs, shared tickets or a network move after issuance. Current controls reject forged location claims and unapproved signed claims; live circumvention resistance must be assessed against the actual trusted ingress before rollout.

## Complete list still pending review

No entry below is activated. Regenerate this inventory with `npm run policy:countries` in the intended environment; the command neither approves locations nor reads cloud configuration.

| Code | Country or territory | Status |
| --- | --- | --- |
| AD | Andorra | pending_review |
| AE | United Arab Emirates | pending_review |
| AF | Afghanistan | pending_review |
| AG | Antigua & Barbuda | pending_review |
| AI | Anguilla | pending_review |
| AL | Albania | pending_review |
| AM | Armenia | pending_review |
| AO | Angola | pending_review |
| AQ | Antarctica | pending_review |
| AR | Argentina | pending_review |
| AS | American Samoa | pending_review |
| AT | Austria | pending_review |
| AW | Aruba | pending_review |
| AX | Åland Islands | pending_review |
| AZ | Azerbaijan | pending_review |
| BA | Bosnia & Herzegovina | pending_review |
| BB | Barbados | pending_review |
| BD | Bangladesh | pending_review |
| BE | Belgium | pending_review |
| BF | Burkina Faso | pending_review |
| BG | Bulgaria | pending_review |
| BH | Bahrain | pending_review |
| BI | Burundi | pending_review |
| BJ | Benin | pending_review |
| BL | St. Barthélemy | pending_review |
| BM | Bermuda | pending_review |
| BN | Brunei | pending_review |
| BO | Bolivia | pending_review |
| BQ | Caribbean Netherlands | pending_review |
| BR | Brazil | pending_review |
| BS | Bahamas | pending_review |
| BT | Bhutan | pending_review |
| BV | Bouvet Island | pending_review |
| BW | Botswana | pending_review |
| BZ | Belize | pending_review |
| CA | Canada | pending_review |
| CC | Cocos (Keeling) Islands | pending_review |
| CD | Congo - Kinshasa | pending_review |
| CF | Central African Republic | pending_review |
| CG | Congo - Brazzaville | pending_review |
| CH | Switzerland | pending_review |
| CI | Côte d’Ivoire | pending_review |
| CK | Cook Islands | pending_review |
| CL | Chile | pending_review |
| CM | Cameroon | pending_review |
| CO | Colombia | pending_review |
| CR | Costa Rica | pending_review |
| CV | Cape Verde | pending_review |
| CW | Curaçao | pending_review |
| CX | Christmas Island | pending_review |
| CY | Cyprus | pending_review |
| CZ | Czechia | pending_review |
| DE | Germany | pending_review |
| DJ | Djibouti | pending_review |
| DK | Denmark | pending_review |
| DM | Dominica | pending_review |
| DO | Dominican Republic | pending_review |
| DZ | Algeria | pending_review |
| EC | Ecuador | pending_review |
| EE | Estonia | pending_review |
| EG | Egypt | pending_review |
| EH | Western Sahara | pending_review |
| ER | Eritrea | pending_review |
| ES | Spain | pending_review |
| ET | Ethiopia | pending_review |
| FI | Finland | pending_review |
| FJ | Fiji | pending_review |
| FK | Falkland Islands | pending_review |
| FM | Micronesia | pending_review |
| FO | Faroe Islands | pending_review |
| FR | France | pending_review |
| GA | Gabon | pending_review |
| GB | United Kingdom | pending_review |
| GD | Grenada | pending_review |
| GE | Georgia | pending_review |
| GF | French Guiana | pending_review |
| GG | Guernsey | pending_review |
| GH | Ghana | pending_review |
| GI | Gibraltar | pending_review |
| GL | Greenland | pending_review |
| GM | Gambia | pending_review |
| GN | Guinea | pending_review |
| GP | Guadeloupe | pending_review |
| GQ | Equatorial Guinea | pending_review |
| GR | Greece | pending_review |
| GS | South Georgia & South Sandwich Islands | pending_review |
| GT | Guatemala | pending_review |
| GU | Guam | pending_review |
| GW | Guinea-Bissau | pending_review |
| GY | Guyana | pending_review |
| HK | Hong Kong SAR China | pending_review |
| HM | Heard & McDonald Islands | pending_review |
| HN | Honduras | pending_review |
| HR | Croatia | pending_review |
| HT | Haiti | pending_review |
| HU | Hungary | pending_review |
| ID | Indonesia | pending_review |
| IE | Ireland | pending_review |
| IL | Israel | pending_review |
| IM | Isle of Man | pending_review |
| IN | India | pending_review |
| IO | British Indian Ocean Territory | pending_review |
| IQ | Iraq | pending_review |
| IS | Iceland | pending_review |
| IT | Italy | pending_review |
| JE | Jersey | pending_review |
| JM | Jamaica | pending_review |
| JO | Jordan | pending_review |
| JP | Japan | pending_review |
| KE | Kenya | pending_review |
| KG | Kyrgyzstan | pending_review |
| KH | Cambodia | pending_review |
| KI | Kiribati | pending_review |
| KM | Comoros | pending_review |
| KN | St. Kitts & Nevis | pending_review |
| KR | South Korea | pending_review |
| KW | Kuwait | pending_review |
| KY | Cayman Islands | pending_review |
| KZ | Kazakhstan | pending_review |
| LA | Laos | pending_review |
| LB | Lebanon | pending_review |
| LC | St. Lucia | pending_review |
| LI | Liechtenstein | pending_review |
| LK | Sri Lanka | pending_review |
| LR | Liberia | pending_review |
| LS | Lesotho | pending_review |
| LT | Lithuania | pending_review |
| LU | Luxembourg | pending_review |
| LV | Latvia | pending_review |
| LY | Libya | pending_review |
| MA | Morocco | pending_review |
| MC | Monaco | pending_review |
| MD | Moldova | pending_review |
| ME | Montenegro | pending_review |
| MF | St. Martin | pending_review |
| MG | Madagascar | pending_review |
| MH | Marshall Islands | pending_review |
| MK | North Macedonia | pending_review |
| ML | Mali | pending_review |
| MM | Myanmar (Burma) | pending_review |
| MN | Mongolia | pending_review |
| MO | Macao SAR China | pending_review |
| MP | Northern Mariana Islands | pending_review |
| MQ | Martinique | pending_review |
| MR | Mauritania | pending_review |
| MS | Montserrat | pending_review |
| MT | Malta | pending_review |
| MU | Mauritius | pending_review |
| MV | Maldives | pending_review |
| MW | Malawi | pending_review |
| MX | Mexico | pending_review |
| MY | Malaysia | pending_review |
| MZ | Mozambique | pending_review |
| NA | Namibia | pending_review |
| NC | New Caledonia | pending_review |
| NE | Niger | pending_review |
| NF | Norfolk Island | pending_review |
| NG | Nigeria | pending_review |
| NI | Nicaragua | pending_review |
| NL | Netherlands | pending_review |
| NO | Norway | pending_review |
| NP | Nepal | pending_review |
| NR | Nauru | pending_review |
| NU | Niue | pending_review |
| NZ | New Zealand | pending_review |
| OM | Oman | pending_review |
| PA | Panama | pending_review |
| PE | Peru | pending_review |
| PF | French Polynesia | pending_review |
| PG | Papua New Guinea | pending_review |
| PH | Philippines | pending_review |
| PK | Pakistan | pending_review |
| PL | Poland | pending_review |
| PM | St. Pierre & Miquelon | pending_review |
| PN | Pitcairn Islands | pending_review |
| PR | Puerto Rico | pending_review |
| PS | Palestinian Territories | pending_review |
| PT | Portugal | pending_review |
| PW | Palau | pending_review |
| PY | Paraguay | pending_review |
| QA | Qatar | pending_review |
| RE | Réunion | pending_review |
| RO | Romania | pending_review |
| RS | Serbia | pending_review |
| RW | Rwanda | pending_review |
| SA | Saudi Arabia | pending_review |
| SB | Solomon Islands | pending_review |
| SC | Seychelles | pending_review |
| SD | Sudan | pending_review |
| SE | Sweden | pending_review |
| SG | Singapore | pending_review |
| SH | St. Helena | pending_review |
| SI | Slovenia | pending_review |
| SJ | Svalbard & Jan Mayen | pending_review |
| SK | Slovakia | pending_review |
| SL | Sierra Leone | pending_review |
| SM | San Marino | pending_review |
| SN | Senegal | pending_review |
| SO | Somalia | pending_review |
| SR | Suriname | pending_review |
| SS | South Sudan | pending_review |
| ST | São Tomé & Príncipe | pending_review |
| SV | El Salvador | pending_review |
| SX | Sint Maarten | pending_review |
| SZ | Eswatini | pending_review |
| TC | Turks & Caicos Islands | pending_review |
| TD | Chad | pending_review |
| TF | French Southern Territories | pending_review |
| TG | Togo | pending_review |
| TH | Thailand | pending_review |
| TJ | Tajikistan | pending_review |
| TK | Tokelau | pending_review |
| TL | Timor-Leste | pending_review |
| TM | Turkmenistan | pending_review |
| TN | Tunisia | pending_review |
| TO | Tonga | pending_review |
| TR | Türkiye | pending_review |
| TT | Trinidad & Tobago | pending_review |
| TV | Tuvalu | pending_review |
| TW | Taiwan | pending_review |
| TZ | Tanzania | pending_review |
| UA | Ukraine | pending_review |
| UG | Uganda | pending_review |
| UM | U.S. Outlying Islands | pending_review |
| US | United States | pending_review |
| UY | Uruguay | pending_review |
| UZ | Uzbekistan | pending_review |
| VA | Vatican City | pending_review |
| VC | St. Vincent & Grenadines | pending_review |
| VE | Venezuela | pending_review |
| VG | British Virgin Islands | pending_review |
| VI | U.S. Virgin Islands | pending_review |
| VN | Vietnam | pending_review |
| VU | Vanuatu | pending_review |
| WF | Wallis & Futuna | pending_review |
| WS | Samoa | pending_review |
| XK | Kosovo | pending_review |
| YE | Yemen | pending_review |
| YT | Mayotte | pending_review |
| ZA | South Africa | pending_review |
| ZM | Zambia | pending_review |
| ZW | Zimbabwe | pending_review |
