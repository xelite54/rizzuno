# Launch-hardening verification — 2026-09-25

Repository: Rizzuno (`xelite54/rizzuno`), local working tree based on `1c639cadca126c35efbb11157417e31d0838b0fa`. These changes have not been pushed or deployed. Local verification is not evidence of production capacity or jurisdictional compliance.

## Final local checks

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed: application, tests and browser harness |
| `npm test` | 290 passed; zero failed, cancelled or skipped. This includes pre-OAuth eligibility/OAuth denial, state gating, CyberTipline non-automation/preservation, moderation/report, appeal, legal acceptance/version, privacy export/erasure, migration, retention and authorization coverage. |
| `npm run security:check` | Zero reported dependency vulnerabilities |
| Gitleaks | Not rerun locally because the binary is not installed. The required CI `security` job runs `gitleaks/gitleaks-action`; that remote check must pass on this exact revision. |
| `npm run test:cluster` | Passed with a real Redis 7.2.7 process and multiple realtime processes, including cross-gateway match, coordinator death/fencing/replacement and Redis reconnect. The isolated binary under `/tmp` did not change repository or deployment configuration. |
| `npm run test:webrtc:browser` | Passed all original assertions, including a 120-second sustained bidirectional media call, skip/rematch, friend call, transport/media recovery, legal rejection/reacceptance, playback termination and sign-out. |
| `npm run test:homepage:runtime` | Passed 181081 ms of real hooks, HTTP, WebSocket and WebRTC, including reconnect, restrictions, legal reacceptance and camera recovery. |
| `npm run test:homepage:browser` | Passed 181271 ms and 8,835 structural/frame samples with stable control nodes. |
| `node scripts/ci-build.mjs` | Production compilation passed using explicitly synthetic, isolated CI configuration; artifact is not deployable production evidence |
| Actual `npm run build` with local deployment configuration | Correctly refused: `Missing launch configuration: LEGAL_OPERATOR_NAME`; production readiness remains blocked |
| `git diff --check` and final diff review | Passed; no conflict markers or unintended architecture replacement |

Browser startup now uses a pinned Chrome for Testing in CI, isolated profiles, an OS-assigned debugging port, DevTools readiness and actionable process diagnostics. The startup deadline and WebRTC assertions were not weakened. The previous [GitHub run](https://github.com/xelite54/rizzuno/actions/runs/35899562523) failed at Chrome startup; its other three jobs passed. The edited revision still requires a successful GitHub Actions run. Local macOS browser results do not prove the Linux runner fix has executed successfully.

## Implemented safeguards and limits

Terms and Privacy versions are `2026-09-25`; historical acceptance records remain and current acceptance is enforced at ticket issuance and realtime admission, with ongoing eligibility checks. The signed pre-OAuth gate stores only eligibility result/time/version, never exact DOB, and proxy tests show Google sign-in/callback fail closed without an eligible result. Guidelines, Safety, Appeals and Copyright text were reviewed together. Launch configuration requires real operator/contact/provider disclosures, an approved recent-match report window, approved retention decisions, explicitly supported countries and the new U.S. operator approvals. Missing data is a release blocker, not a fabricated value.

Migrations `0015_launch_evidence_retention`, `0016_recent_matches_appeals` and `0017_cybertipline_preservation` were exercised with the full migration chain in isolated PGlite tests. They have not been applied to an external database in this session. Ordinary underage reports create no CyberTipline case. Only an authorized staff entry records a manual decision/submission; a submitted case requires a receipt and at least one year of scoped preservation, and the database rejects early shortening. Recent-match reports derive the counterpart from the private server ledger, and appeal views exclude confidential moderation material. Automatic screenshots are not implemented; calls are not continuously recorded or continuously analyzed, and no video evidence archive was added. Specialized severe-content detection remains unavailable without a real provider; generic nudity scores are not CSAM determinations.

Retention tests cover bounded purges, holds, preservation snapshots, referential integrity and durable image-deletion retries. Storage tests use HTTP stubs, not the deployed Supabase bucket. Privacy actions require authenticated admin review, identity verification, retention review and a case reference; erasure records justified retained categories and pending object cleanup. Safety evidence is restricted and audited, with conflicted reviewers excluded.

## Outstanding launch gates

Complete the [operator legal checklist](PRODUCTION_LEGAL_CHECKLIST.md), [regional checklist](REGIONAL_LAUNCH_CHECKLIST.md), [retention policy](RETENTION.md), [safety escalation workflow](SAFETY_ESCALATION.md) and [release protections](PRODUCTION_WORKFLOW.md). Operator identity, reviewed deployment disclosures, retention approvals, safety staffing and any applicable external DMCA registration must be real and verified. Optional governing-law/dispute text requires review.

Apply and verify migration 0017 in staging before production; configure and validate private Storage, Redis, trusted Vercel country/region headers, any reviewed `SUPPORTED_US_REGIONS`, short-lived TURN credentials, provider credentials, retention/inventory scheduling, alerting and backup expiry/restore. Complete the U.S. state matrix with every approval unset by default. Enable the documented GitHub branch protections and deploy only the exact passing commit with consistent web/realtime legal versions. No remote settings, external DMCA registration or NCMEC integration were changed or asserted here.

Run the [staging load plan](STAGING_LOAD_PLAN.md) against real Postgres/pooler, Redis and multiple realtime instances, with actual browser media, TURN fallback, reconnect/rematch/report/image traffic and measured resource saturation. The guarded staging WebSocket harness was not run externally because staging tickets/configuration were not supplied; it explicitly does not test media or TURN. Fixture throughput is not mass-production proof. Real-provider behavior, physical-device Google sign-in and real TURN relay remain external acceptance gates.

Earlier verification recorded migrations 0013/0014 and deployed health checks on 2026-09-19. Those historical observations were not revalidated here and do not establish the state of this undeployed revision.
