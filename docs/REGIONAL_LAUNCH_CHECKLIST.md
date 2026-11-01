# Regional launch gates

This is an operator decision record, not a certification of GDPR, DSA, UK Online Safety Act, COPPA or other compliance. No country is enabled by default in production. Record reviewer, date, evidence and next review date for every gate. Do not add a country until its review is complete.

November 1, 2026 availability update: the 52 countries in [GEOGRAPHIC_ACCESS.md](GEOGRAPHIC_ACCESS.md) are excluded, including the United States, United Kingdom and EU/EEA countries. The jurisdiction notes below retain review context and safety obligations; they are not permission to launch in excluded locations. Neither an approval flag nor a U.S. state list overrides a country exclusion.

## All launches

- Publish actual `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `LEGAL_NOTICE_EMAIL` and `LEGAL_DEPLOYMENT_DISCLOSURE`; set `COPYRIGHT_NOTICE_EMAIL` only when a separate monitored copyright inbox exists. The disclosure must identify every actual hosting, database/pooler, object-storage, Redis, moderation, TURN, monitoring/logging and backup provider, processing region, purpose, and relevant international transfer arrangement. Do not substitute examples from architecture docs for actual deployments.
- Record counsel/operator signoff in `LAUNCH_REVIEW_REFERENCE`; set `LEGAL_REVIEW_APPROVED=true` only after review. Optional `LEGAL_GOVERNING_LAW` and `LEGAL_DISPUTE_RESOLUTION` require `LEGAL_TERMS_REVIEWED=true`. No law, entity, venue or license is inferred by code.
- Configure and validate the expiring, per-country/state age decisions in `AGE_POLICIES_JSON` using [AGE_ASSURANCE.md](AGE_ASSURANCE.md). Use a reviewed provider method wherever additional assurance is required; otherwise keep the location unavailable. Test the real provider bridge, privacy notice, result binding, expiry and deletion behavior before enabling it. A checkbox alone does not satisfy additional-assurance requirements.
- Approve each retention category, scheduler/alerts, provider backup expiry and restore handling: [RETENTION.md](RETENTION.md).
- Appoint verified administrators and trained safety reviewers; rehearse [SAFETY_ESCALATION.md](SAFETY_ESCALATION.md). Set `SAFETY_WORKFLOW_APPROVED=true` after rehearsal.
- Approve `RECENT_MATCH_REPORT_WINDOW_HOURS` as a product-safety window, and staff/rehearse the appeal queue including trained review of underage decisions.
- Complete the provider-backed staging matrix in [STAGING_LOAD_PLAN.md](STAGING_LOAD_PLAN.md); choose a conservative admission limit from measured results.
- Enforce GitHub rulesets and deployment gates in [PRODUCTION_WORKFLOW.md](PRODUCTION_WORKFLOW.md). Run `npm run launch:check` and the full required CI checks against the actual release revision and real target configuration.

## United States

- Actual operator/contact disclosures and monitored privacy request channel; verified identity, case references, access review, erasure and retention decisions.
- Make and record the operator/legal decision whether to rely on 17 U.S.C. §512. Set `DMCA_512_RELIANCE` explicitly. If true, register the actual designated DMCA agent externally with the [U.S. Copyright Office](https://www.copyright.gov/dmca-directory/), publish matching name/address/phone/email, calendar renewal and change obligations, and rehearse notice, counter-notice, restoration and repeat-infringer handling. `DMCA_AGENT_REGISTERED=true` is an operator attestation, not registration performed by this repository.
- When `DMCA_512_RELIANCE=true`, configure `DMCA_AGENT_NAME`, `DMCA_AGENT_ADDRESS`, `DMCA_AGENT_PHONE`, `DMCA_REGISTRATION_REFERENCE`. The configured copyright-notice email (or `LEGAL_NOTICE_EMAIL` fallback) must be the monitored designated-agent channel. Do not rely on §512 merely because `/copyright` exists.
- Counsel review of child-safety obligations, applicable reporting thresholds, designated recipients, emergency handling, state privacy rights and retention. Self-attestation is not verified age and does not establish COPPA or state-law compliance.
- Approve and rehearse the distinct possible-under-13 safety/privacy flow in [SAFETY_ESCALATION.md](SAFETY_ESCALATION.md) before setting `UNDER13_RESPONSE_PROCEDURE_APPROVED=true`. The repo does not determine age, collect identity documents, obtain parental consent, or decide legal applicability.
- Approve and rehearse the manual CyberTipline workflow before setting `CYBERTIPLINE_PROCEDURE_APPROVED=true`. Ordinary underage reports do not create cases or submissions. Staff, not code, decide whether to record `not_required`, `manual_report_required`, or `manual_report_submitted`; submission remains external/manual. Confirm receipt handling, restricted access, audit review, and scoped one-year preservation without new recordings/screenshots.
- Confirm named trained reviewers and coverage before setting `TRAINED_SAFETY_REVIEWERS_CONFIRMED=true`. Approve the state-by-state breach workflow in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) before setting `BREACH_RESPONSE_APPROVED=true`.
- Review actual providers and processing regions before setting `PROVIDER_REGION_DISCLOSURE_REVIEWED=true`.
- Keep `SUPPORTED_US_REGIONS` empty while the entire US is excluded. [US_STATE_LAUNCH_MATRIX.md](US_STATE_LAUNCH_MATRIX.md) remains a historical review template and does not enable any state. Any future availability change requires a separately authorized country-policy change and new legal review.

## EU/EEA

- Controller identity/contact and processor/subprocessor contracts and inventory.
- International transfer mechanism and region review; GDPR purposes, lawful bases, transparency, rights, retention, security and representative/DPO requirements where applicable.
- DSA service classification, notice-and-action, complaint/redress, transparency, legal representative and contact obligations where applicable.
- Age/access and safety review for this actual random-video product. Do not infer compliance from an 18+ checkbox.

## United Kingdom

- Online Safety Act scope determination and children's-access assessment.
- Illegal-content risk assessment, reporting and complaints controls, record keeping and accountable safety operation.
- Age-assurance decision and implementation where required; do not substitute the current self-attestation for a required assurance mechanism.
- UK privacy, processor and transfer review.

## Other countries

Operator/legal review of this service before adding each country to the allowlist. A regional commercial target does not automatically approve every country within it.

## Rollout mechanism and limitations

`SUPPORTED_COUNTRIES` is a comma-separated list of uppercase country codes, validated by `lib/geographicAccess.ts` (no `*`, no excluded codes). Empty or invalid configuration denies product access. Each approved location needs a current `AGE_POLICIES_JSON` decision, and applicable subnational restrictions use a separate `SUPPORTED_SUBDIVISIONS_JSON` allowlist plus scoped age policies. `LAUNCH_GEO_SOURCE=vercel` selects the supported trust boundary. The web deployment must actually run behind Vercel, which supplies `x-vercel-ip-country` and `x-vercel-ip-country-region`; direct/untrusted proxy deployments are not supported for public rollout. Unknown, excluded and unapproved locations get HTTP 451 on product, API and sign-in requests. Public legal/designated safety pages remain reachable. Version-2 signed ticket claims are checked during cluster-gateway and WebSocket hello, and current location approvals are rechecked during live access. Use identical configuration/revision on web and realtime. Direct WS access cannot mint a valid ticket or supply a trusted location in its hello fields.

IP geolocation is not residency verification and cannot reliably defeat VPNs. Regional review must decide whether this restriction is sufficient. Reject unknown locations, test forged headers against the real deployed edge, and verify preview/custom domains cannot bypass that edge. A different hosting topology needs a reviewed trusted-geolocation adapter before launch; do not trust arbitrary browser-supplied country headers.

Removing a country prevents new requests/tickets; drain existing realtime connections when narrowing a rollout. Approving a new country requires a new recorded legal review, not just an environment edit. Material disclosure changes require a legal version bump and matched web/realtime deployments.
