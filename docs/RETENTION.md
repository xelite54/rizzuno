# Retention decisions

Current implementation purges expired abuse/rate-limit counters only, with a one-day grace. It does not automatically delete safety/legal records. `lib/retention.ts` explicitly reports null/unapproved policies; null is not a claim that indefinite retention is lawful.

Operator/counsel must approve purpose, duration, start event, hold overrides, access, backup expiry and deletion verification for: friend-message history; reports; moderation actions/events; legal acceptance; account tombstones/enforcement markers; privacy-operation logs; private image objects/orphans. Record approver, effective date and jurisdiction. No automatic safety/legal purge is enabled from an arbitrary environment value.

A future approved purge must select bounded batches, exclude legal holds, retain necessary audit history, dry-run counts, test on restored data and coordinate reply foreign keys. Deleting old friend messages must null/remove reply references in the same transaction without exposing another friendship. Account erasure clears profile/social content but retains required safety/legal state as disclosed. Supabase backups and Storage bytes have distinct lifecycles; schedule/verify their deletion separately.
