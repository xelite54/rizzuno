# Production monitoring

Ship structured events through `configureObservability` to the chosen metrics/log provider. The explicit field allowlist remains mandatory. Never attach raw errors, URLs, request bodies, account IDs, emails, cookies, credentials, image bytes, SDP, IP addresses or chat text. Use low-cardinality event names and route templates. Access to moderation records is separate from telemetry.

Collect `http.request` (status/duration) for API 5xx rate and latency; `http.unhandled_error` covers uncaught Next errors. Infrastructure access logs remain the source for edge/CDN/auth traffic that does not reach wrapped handlers. Alert on >1% 5xx over 5 minutes with at least 100 requests, and repeated readiness 503s. Tune thresholds after recording a baseline.

Collect database query duration, pool connection/wait counts, connection/query errors; Redis connection/reconnect and latency; coordinator acquired/lost generation; command/event stream lag; socket connect/disconnect and ticket validation; matchmaking queue depth/latency, reservation rollback and room setup timeout; TURN route failures; image moderation unavailable/rejection; urgent reports/backlog; cleanup failures. Client-only WebRTC ICE/media failures require the browser acceptance evidence: server setup timeouts are not a complete measure of media quality.

Alert immediately on stream gaps, repeated coordinator changes, Redis disconnects, underage reports awaiting review, image moderation outage, and cleanup failure. Keep report IDs and details inside the authorized moderation console. Run external `/health` and `/ready` checks every minute. `/health` alone is not readiness. Monitor Vercel and Railway resource limits and provider quotas separately.

The repository supplies instrumentation, not a configured alert destination or staffed on-call rota. Operator must select provider, enable its drain/exporter, test a synthetic alert, set log retention, restrict access and name primary/backup responders. Sink exceptions must never break requests. Use counts and percentiles; do not infer an SLO from a single healthy request.
