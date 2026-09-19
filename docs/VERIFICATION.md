# Launch-hardening verification, 2026-09-19

Production database: 0013 and 0014 applied; security query passed; anon/authenticated cannot SELECT users or access internal tables; postgres retains application privileges; no unvalidated constraints remain. Railway /health and /ready both 200 after migration. Public homepage, Terms and Privacy 200; unauthenticated legal/status, profile/me and realtime/ticket correctly 401. Authenticated Google journeys were not tested live in this session. Railway's current deployment was observed SUCCESS; this working-tree application change is not deployed.

Local checks and load evidence are recorded by the final task report. Tests use isolated PostgreSQL and fixture provider/DB adapters, plus real Redis and browser transports. Object-store tests verify ordering/private-bucket enforcement/read-back mismatch rejection with an HTTP stub; they do not establish an actual configured bucket or completed legacy migration.

Required before launch: private object storage, deployed configuration and smoke tests, Data API project switch, Redis region alignment, protected branches/deployments, alert routing, backup/restore drill, operator legal/retention decisions, physical Mac/phone Google acceptance and real TURN relay test. None is implied by successful compilation.

Final local checks: clean npm ci; lint; root npx tsc --noEmit; 261 unit/integration tests; production build using clearly synthetic provider config; real two-process Redis failover test. npm audit found zero vulnerabilities. Gitleaks scanned 177 reachable commits and the current tracked/new source files with no detected leaks. Detection is not a guarantee that every possible secret format is covered.

Final browser rerun passed with a 120272 ms sustained call and 24 samples, including skip/rematch, friend call, media recovery, playback termination and sign-out. Real production TURN and physical-device acceptance remain outstanding.

The full-duration browser assertions completed successfully, but the process retained its esbuild subprocess afterward. The harness now calls esbuild.stop() during cleanup. A subsequent diagnostic run with MEDIA_HOLD_MS=5000 passed all assertions and exited 0; that short run verifies cleanup, not a new two-minute media result.
