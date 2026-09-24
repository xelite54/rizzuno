# Retention policy and operation

No legally correct duration is supplied by the repository. Production validation requires `RETENTION_POLICY_JSON`, an object containing `approvedBy`, `caseReference` (6–80 letters/digits/underscore/hyphen), future `reviewBy` (ISO date/time), and `categories`. Expired approvals fail the launch check. The scheduler also validates approval on every run and fails visibly when it expires.

Each category requires `{ "mode": "automatic" | "review" | "external", "days": <operator-approved positive integer>, "reason": "<specific purpose and decision>" }`. `days` is mandatory for automatic/external rules; review rules require a documented manual disposition and review before `reviewBy`. Review mode is not permission for indefinite storage. There are no example legally approved durations. `scripts/ci-launch-fixture.mjs` is exclusively a test fixture and must never be copied into deployment configuration.

| Category key | Processing |
| --- | --- |
| friendMessages | Automatic creation-age expiry or reviewed disposition; referenced reply parents survive until dependent replies expire. |
| friendRequests | Automatic creation-age expiry or reviewed disposition, including pending requests. |
| recentMatches | Minimal server-side session ledger used only for safety reporting. Automatic purge waits until the report window ends and no report references the session. |
| reports | Report and safety decision retention. Pending reports and open investigations do not expire automatically. Linked actions and evidence must expire first. |
| reportEvidence | Bounded text/history evidence and disabled/captured/deleted capture metadata. Open investigations do not expire. Captured-object deletion requires an approved evidence-storage adapter before capture can be enabled. |
| moderationActions | Separate action expiry or reviewed disposition. Active account enforcement is not cleared by log expiry; linked appeals expire first. |
| appeals | Appeal request, user reference, status, reviewer, user-facing resolution and timestamps. Open appeals never expire automatically. |
| imageChecks | Hashes, scores and model/provider/check metadata, no extra image copy. |
| legalAcceptance | Version changes always append/preserve history. Automatic expiry only for erased accounts; active-account history requires review. |
| privacyOperations | Export/erasure audit and recorded retained categories/reasons. |
| accountTombstones | `review` only. Deleted identity remains denied; automatic deletion would allow reentry. Review minimized denial records and legal basis separately. |
| storedImages | `automatic` required for unreferenced object age. Referenced product images follow product lifecycle; holds prevent physical deletion. |
| heldRecords | Restricted pre-change copies preserved during a legal hold; automatic expiry only after all holds are released, or reviewed disposition. |
| securityLogs | `external` required: configure actual expiry/access for application-controlled security and abuse logs. |
| infrastructureLogs | `external` required: configure actual application/host log expiry, access and collection limits. |
| backups | `external` required: configure actual provider expiry and restore protocol separately from primary rows. |

`npm run retention:purge` runs one batch, at most 100 records per category by default (API hard cap 500). Schedule recurring runs with one worker and an alert on nonzero exit or stale heartbeat. Confirm scheduling with `RETENTION_SCHEDULER_CONFIRMED=true` only once verified. Monitor pending reports, open investigations, deletion queue count/oldest age/attempts and manual-review backlog; a successful batch is not evidence the entire backlog is gone. Expired rate-limit tables retain their existing technical cleanup windows.

`npm run retention:inventory -- <offset>` scans one private Storage inventory page and prints `nextOffset`; continue until null, then restart at zero in the next inventory cycle. It only handles generated root image keys, waits the approved orphan age, and queues candidates. Inventory and deletion are separate phases: finish a scan before draining deletions to avoid offset shifts. Repeated complete scans handle provider changes during listing. This catches interrupted uploads that never obtained a DB reference. The purge worker drains the durable deletion queue through the Storage HTTP API, never by deleting Supabase metadata rows. It rechecks live and preserved references first. Alert on deletion failure; do not mark a privacy request complete until its associated objects are absent or a documented hold applies.

## Holds and integrity

Trained safety reviewers create/release holds using the restricted safety case console; record case, reason, actor and time. Holds are deliberately global and conservative: an active hold prevents maintenance purges and account erasure. A transaction lock serializes hold activation with those operations, including physical object deletion. Product changes still work; database triggers preserve the prior affected record in moderator-restricted `held_records` while a hold is active. Blocking therefore remains available without destroying held relationship evidence. Identical pre-change rows are not copied twice. Image objects referenced by preserved records remain protected even after hold release until the preserved record expires. Holds must have an assigned owner and recurring review; release requires documented authority.

New tables have RLS enabled with no public policies and no Data API grants. App-server owner access remains necessary; do not give normal users direct database access. Verify effective privileges with `scripts/verify-database-security.sql` after migrations and on staging.

Foreign keys and application dependencies are respected. Message parents referenced by newer replies are skipped. Report evidence cascades only with its report policy; open safety cases never expire. Batch retries are safe. A held record is never selected for purge while a hold is active.

## Privacy handling and backup restore

The authenticated admin privacy action requires `identityVerified=true`, `retentionReviewed=true` and a case reference. Standard exports contain requester-accessible product data; confidential reports, evidence and peer stable IDs are excluded. Received messages are included only while their friendship remains accessible. Any broader disclosure requires individual review.

Erasure clears profile/gender/posts/social content/free entitlement, records retained categories and reasons, and leaves a deleted identity. Storage work is queued in the erasure transaction. A Storage failure is surfaced; rerun the deletion worker and verify completion rather than silently closing the case. Payment-customer mappings still require separate billing handling. Erasure rejects active legal holds.

Backups and infrastructure copies require operator configuration. Before restoring, isolate the restored environment, replay deletion/tombstone and hold records from a protected current audit source, remove erased product/Storage content, and verify denial of reentry before admitting traffic. Record backup expiry and any justified preservation separately. No application command proves provider backups have expired.

The privacy action returns `productErased` and `storagePending`; `erased` is true only when no associated queued objects remain. Previously held/shared references may remain pending with a documented reason. Deletion jobs are recorded atomically by database triggers when profile/post references change, and erasure audits preserve the affected reference list for retry tracking. Referenced and failed jobs receive bounded retry delays so they cannot starve later work.
