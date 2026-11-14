# Geographic activation configuration

No jurisdiction is approved or activated by these templates.

`geographic-access.pending.json` contains the five non-secret policy environment settings that must match on Vercel and Railway. Its empty country allowlist and review object deny product access everywhere. Do not deploy this as an access-unlocking configuration. Use the full `.env.example` for all other required service settings; do not copy production credentials into this directory.

`jurisdiction-review.template.json` is an incomplete pending review record. Store a completed, evidenced decision under its exact jurisdiction key in `AGE_POLICIES_JSON`. Use a recognized country code for a national review or `COUNTRY-SUBDIVISION` for a scoped review. U.S. approvals always use individual `US-STATE` keys. The null age, missing reference/deadline, unavailable method, and pending status intentionally cannot grant access.

For each jurisdiction, the responsible reviewer must document the required age (at least 18 and any higher applicable threshold), an adequate assurance method, the actual review reference, a future review deadline, and legal/privacy/safety scope before changing status to approved. Do not guess these values. Self-attestation requires explicit support in that review; provider mode additionally requires the reviewed provider bridge and real acceptance testing.

After those approvals and operational release approval:

1. Add only approved country codes to `SUPPORTED_COUNTRIES` on both services. KP, IR, CU, SY, RU, BY, CN and AU always fail, regardless of records or environment flags.
2. Set `SUPPORTED_SUBDIVISIONS_JSON` where subnational review is required. A configured list requires an identified, approved subdivision and its own policy. Set the U.S. list in that setting and/or `SUPPORTED_US_REGIONS`; both intersect when present. A national approval never replaces a state approval.
3. Set identical `AGE_POLICIES_JSON` decisions and `LAUNCH_GEO_SOURCE=vercel` on both services. Only actual Vercel ingress supplies web location. Railway verifies the signed country/subdivision and current policy; incoming WebSocket country headers or hello fields supply no proof.
4. Export ONLY the five policy keys as string-valued JSON objects to private temporary files. Run `npm run policy:compare -- /private/tmp/web-policy.json /private/tmp/realtime-policy.json`. Equality proves configuration consistency, not approval or startup readiness. It compares resolved subdivision intersections and every review field without printing references.
5. Run `npm run launch:check` separately with each actual deployment environment. Keep `SKIP_LAUNCH_READINESS=false`; `true` is rejected. Never set `RIZZUNO_CI_COMPILE_ONLY` on a deployed service. Build-only fixtures cannot pass runtime readiness.
6. Require all four CI jobs for the exact release revision, review the release, and deploy both services from that revision. Enable Railway wait-for-CI and Vercel deployment checks/protected release controls before releasing. Rebuild using actual production configuration; do not deploy CI's `.next` artifact.
7. Verify the actual Vercel ingress, homepage, Google login, provider verification where applicable, ticket issuance, direct WebSocket rejection, two-device media, matching, reporting and moderation. Keep unapproved, unknown and excluded locations denied.

Use `npm run policy:countries` in the intended environment for the full recognized-country inventory, approval locations and denial reasons. It reads the current process only and makes no cloud changes. It includes territories and the pre-existing XK code, without claiming those are independent sovereign countries. Check `docs/INTERNATIONAL_ACCESS_2026-11-14.md` for the observed production state and outstanding external work.
