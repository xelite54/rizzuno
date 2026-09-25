# Regional launch gates

This is an operator decision record, not a certification of GDPR, DSA, UK Online Safety Act, COPPA or other compliance. No country is enabled by default in production. Record reviewer, date, evidence and next review date for every gate. Do not add a country until its review is complete.

## All launches

- Publish actual `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `LEGAL_NOTICE_EMAIL` and `LEGAL_DEPLOYMENT_DISCLOSURE`; set `COPYRIGHT_NOTICE_EMAIL` only when a separate monitored copyright inbox exists. The disclosure must identify every actual hosting, database/pooler, object-storage, Redis, moderation, TURN, monitoring/logging and backup provider, processing region, purpose, and relevant international transfer arrangement. Do not substitute examples from architecture docs for actual deployments.
- Record counsel/operator signoff in `LAUNCH_REVIEW_REFERENCE`; set `LEGAL_REVIEW_APPROVED=true` only after review. Optional `LEGAL_GOVERNING_LAW` and `LEGAL_DISPUTE_RESOLUTION` require `LEGAL_TERMS_REVIEWED=true`. No law, entity, venue or license is inferred by code.
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
- Complete [US_STATE_LAUNCH_MATRIX.md](US_STATE_LAUNCH_MATRIX.md). Put only individually reviewed states/DC in the required non-empty `SUPPORTED_US_REGIONS` allowlist, then set `US_STATE_LAUNCH_REVIEW_APPROVED=true` only after that operator review. No state is pre-approved by the repository.

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

`SUPPORTED_COUNTRIES` is a comma-separated list of uppercase country codes, validated by `lib/country.ts` (no `*`). A production U.S. launch requires a non-empty `SUPPORTED_US_REGIONS` list of reviewed 50-state/DC codes; blank no longer means nationwide access. `LAUNCH_GEO_SOURCE=vercel` selects the currently supported trust boundary. The web deployment must actually run behind Vercel, which supplies `x-vercel-ip-country` and `x-vercel-ip-country-region`; direct/untrusted proxy deployments are not supported for public rollout. Missing, unknown or unsupported U.S. regions fail closed. Unknown or denied countries get HTTP 451 on product and sign-in requests. Public legal/contact pages remain reachable. Ticket issuance checks the same allowlist; the signed country claim is checked during WebSocket hello. Use identical configuration/revision on web and realtime. Direct WS access cannot mint a valid ticket.

IP geolocation is not residency verification and cannot reliably defeat VPNs. Regional review must decide whether this restriction is sufficient. Reject unknown locations, test forged headers against the real deployed edge, and verify preview/custom domains cannot bypass that edge. A different hosting topology needs a reviewed trusted-geolocation adapter before launch; do not trust arbitrary browser-supplied country headers.

Removing a country prevents new requests/tickets; drain existing realtime connections when narrowing a rollout. Approving a new country requires a new recorded legal review, not just an environment edit. Material disclosure changes require a legal version bump and matched web/realtime deployments.
