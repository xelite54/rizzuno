# Rollback

Before release record Vercel and Railway revision IDs, migration ledger, environment-key names, and backup restore point. Provision private image storage and required config before deploying this change. Stage and test first. A compilation using CI placeholders is not a deployed integration check.

Application rollback: stop/drain realtime admission if protocol or schema compatibility is uncertain, restore the last known-good Vercel/Railway release, and verify both readiness and authenticated journeys. Never roll back only one incompatible participant blindly. Coordinator replacement disconnects calls.

Migrations are append-only. Failed migrations roll back their transaction and ledger claim. Correct a failure in a NEW migration; never edit 0001–0012 or mark an unexecuted migration applied. 0013 revokes Data API access while preserving the server migrator role; do not undo it by granting PUBLIC/anon/authenticated access. 0014 validates existing constraints and adds an index; application rollback does not need to undo these protections.

Image migration replaces a data URL only after moderated upload and full read-back verification, using compare-and-swap. Old and new references coexist. Once any references move, retain the new media route during application rollback (or restore the old DB bytes from a verified backup). Old releases without `/api/media` cannot serve those references. Keep bucket contents and encryption/access settings; do not delete objects as a rollback shortcut.

If data corruption occurred, use DATABASE_RECOVERY.md. Code rollback does not reverse data changes. Restore drills and production rollback are not claimed to have been performed.
