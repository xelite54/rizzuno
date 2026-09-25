/**
 * Ordered, append-only list of schema migrations. Each one runs at most
 * once (tracked in `schema_migrations`, see lib/db.ts) — never edit a
 * migration that's already shipped; add a new one instead, the same rule
 * as the legal-acceptance version bumps in lib/legalVersions.ts.
 *
 * Timestamps are stored as BIGINT epoch milliseconds rather than
 * TIMESTAMPTZ — that's what `Date.now()` produces everywhere this data is
 * read/written in lib/db.ts, and matching it exactly kept the migration
 * from SQLite (where these were plain INTEGER epoch-ms columns) behavior-
 * neutral instead of introducing timezone-conversion semantics nothing
 * else in the codebase expects.
 */
export type Migration = { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at BIGINT NOT NULL,
        banned_at BIGINT,
        ban_reason TEXT,
        suspended_until BIGINT,
        suspend_reason TEXT,
        deleted_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS legal_acceptance (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        document TEXT NOT NULL,
        version TEXT NOT NULL,
        accepted_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_legal_acceptance_user ON legal_acceptance(user_id, document);

      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE(blocker_id, blocked_id)
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        reported_id TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT,
        match_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

      CREATE TABLE IF NOT EXISTS moderation_actions (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        actor_admin_id TEXT NOT NULL,
        report_id TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        suspend_until BIGINT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_target ON moderation_actions(target_user_id);
    `,
  },
  {
    // Makes lib/db.ts's recordAcceptance() idempotent: it now upserts with
    // `ON CONFLICT (user_id, document, version) DO NOTHING`, so a client
    // retrying POST /api/legal/accept after a dropped response (the request
    // actually succeeded server-side, but the client never saw that) can't
    // create duplicate rows or otherwise change the outcome.
    //
    // recordAcceptance() had no such guard before this migration, so a
    // database that's been live for a while may already have genuine
    // duplicate rows for the same (user_id, document, version) — the DELETE
    // below clears those first (keeping the earliest one recorded, by
    // accepted_at then id as a deterministic tie-break) so the UNIQUE
    // constraint that follows can actually be added. This only removes
    // *duplicate* rows; it never touches what was accepted or when the
    // surviving row says it happened.
    id: "0002_legal_acceptance_unique",
    sql: `
      DELETE FROM legal_acceptance a USING legal_acceptance b
        WHERE a.user_id = b.user_id
          AND a.document = b.document
          AND a.version = b.version
          AND (a.accepted_at, a.id) > (b.accepted_at, b.id);

      ALTER TABLE legal_acceptance
        ADD CONSTRAINT legal_acceptance_user_document_version_key
        UNIQUE (user_id, document, version);
    `,
  },
  {
    // Adds server-side, permanently-unique usernames. Previously the
    // username a person picks in ChooseUsername (and can later change from
    // My Profile → Edit profile) was never sent to or stored by Rizzuno's
    // server at all — client-side only, per lib/db.ts's own long-standing
    // "no email, name, or profile content lives server-side" design, and
    // per the Privacy Policy's Section 4 (now updated to reflect this
    // change — see the accompanying legal-version bump). This migration is
    // a deliberate, narrow exception to that design specifically for
    // uniqueness: the column holds nothing but the lowercase username
    // itself, tied to the same account id everything else here already
    // uses, so a real match is never shown two different people claiming
    // to be the same handle.
    //
    // Nullable — not every account has picked a username yet — and a plain
    // Postgres UNIQUE index already treats multiple NULLs as non-colliding,
    // so accounts mid-onboarding never conflict with each other.
    id: "0003_users_username",
    sql: `
      ALTER TABLE users ADD COLUMN username TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `,
  },
  {
    // The real backend behind the Friends feature — previously a request
    // only ever set a flag on the sender's own screen (see
    // FRIENDS_ENABLED's history in lib/featureFlags.ts). `friend_requests`
    // is the durable, account-to-account record of who asked whom;
    // `friendships` is the resulting mutual relationship once accepted (or
    // auto-formed if both sides happened to request each other).
    //
    // `friendships` always stores the lower account id as user_a_id and the
    // higher as user_b_id (enforced in application code, see lib/db.ts's
    // pairKey()) — a friendship is symmetric, and storing it this one
    // canonical way (rather than once per direction) is what lets a plain
    // UNIQUE constraint prevent a duplicate row for the same pair.
    id: "0004_friends",
    sql: `
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        resolved_at BIGINT,
        UNIQUE (sender_id, recipient_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient ON friend_requests(recipient_id, status);
      CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, status);

      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        user_a_id TEXT NOT NULL,
        user_b_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE (user_a_id, user_b_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b_id);
    `,
  },
  {
    // Profile photo, bio, and posts move from browser-only localStorage
    // (hooks/useMyProfile.ts, entirely client-side) to server-authoritative
    // storage — the same narrow-exception reasoning migration
    // 0003_users_username already established for username: another
    // account can never see a friend's photo/bio/posts if the only copy
    // ever lived in the VIEWING account's own browser (see the friend-
    // profile bug this fixes — a friend profile could only ever show
    // whatever was already sitting in the CURRENT browser, never the
    // actual friend's own content). `profile_photo`/`bio` are nullable —
    // an account with nothing set yet has NULL, not an empty string, so
    // "never set" and "explicitly cleared" stay distinguishable. `posts`
    // gets its own table (one profile can have many) rather than a JSON
    // column, so a single post can be deleted/queried without rewriting
    // the whole array — same reasoning `friend_requests`/`friendships`
    // already used over a single denormalized blob.
    id: "0005_profile_fields",
    sql: `
      ALTER TABLE users ADD COLUMN profile_photo TEXT;
      ALTER TABLE users ADD COLUMN bio TEXT;

      CREATE TABLE IF NOT EXISTS user_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data_url TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_posts_user ON user_posts(user_id, created_at DESC);
    `,
  },
  {
    // The one centralized image-moderation pipeline's audit log AND its
    // moderation cache source (see lib/imageModeration/) — every profile
    // photo/post/chat image upload writes exactly one row here, whatever
    // the outcome, before (allow) or instead of (review/block) ever being
    // persisted/sent anywhere else. `image_hash` + `policy_version` +
    // `provider_model_version` together are the cache key: a later upload
    // of the exact same normalized bytes, under the exact same policy and
    // provider version, reuses the matching row's decision instead of
    // re-paying the provider — but a policy or provider upgrade changes
    // the version strings, so old decisions are never silently reused
    // against different rules. `categories` is a JSON-encoded array of
    // {category, score} — plain TEXT, matching every other JSON-shaped
    // field already stored this way in this schema (no JSONB elsewhere to
    // be consistent with). Deliberately does NOT store the image itself —
    // a rejected image is never retained anywhere past the request that
    // produced it, moderated or not.
    id: "0006_moderation_events",
    sql: `
      CREATE TABLE IF NOT EXISTS moderation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        image_hash TEXT NOT NULL,
        decision TEXT NOT NULL,
        categories TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_reference TEXT,
        policy_version TEXT NOT NULL,
        provider_model_version TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_events_cache
        ON moderation_events(image_hash, policy_version, provider_model_version, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_moderation_events_user
        ON moderation_events(user_id, decision, created_at DESC);
    `,
  },
  {
    // Replaces the per-process, in-memory rate limiter
    // (lib/apiRateLimit.ts) specifically for image-moderation uploads —
    // Rizzuno runs as multiple, separately-deployed processes (the
    // Vercel-deployed Next.js app AND the Railway-deployed realtime
    // server both call lib/imageModeration's moderateImage(), and Vercel
    // itself can run more than one serverless instance concurrently), so
    // an in-memory counter only ever sees the requests that happened to
    // land on the same process — trivially bypassable by spreading
    // uploads across instances. One row per (user_id, surface): a fixed
    // window counter, not a per-attempt log — self-bounded at roughly
    // (number of accounts × 3 surfaces) rows, no cleanup job needed. See
    // lib/db.ts's checkAndIncrementImageModerationRateLimit for the
    // atomic upsert that reads and increments this in one round trip.
    id: "0007_image_moderation_rate_limits",
    sql: `
      CREATE TABLE IF NOT EXISTS image_moderation_rate_limits (
        user_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        window_start BIGINT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (user_id, surface)
      );
    `,
  },
  {
    id: "0008_rizz_plus",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));
      CREATE TABLE IF NOT EXISTS billing_customers (user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        subscription_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL,
        paid_until BIGINT NOT NULL, event_created BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS billing_subscription_user ON billing_subscriptions(user_id);
    `,
  },
  {
    // The real backend behind Friends' text chat — previously entirely
    // local React state in FriendsPanel.tsx (never sent anywhere), so the
    // other friend could never receive a message, a refresh lost
    // everything, and offline delivery was impossible. See
    // server/ws-server.ts's "friend-chat-send"/"friend-chat-read" handlers
    // (the only writers) and app/api/friends/messages/[friendshipId] (the
    // only reader of history).
    //
    // `client_message_id` + `UNIQUE(sender_id, client_message_id)` is what
    // makes a retried send idempotent — see lib/db.ts's sendFriendMessage().
    // `read_at` is nullable — unread until a value is set — rather than a
    // separate boolean, so "when" is available for free wherever "whether"
    // is needed.
    id: "0009_friend_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS friend_messages (
        id TEXT PRIMARY KEY,
        friendship_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        text TEXT NOT NULL,
        client_message_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        read_at BIGINT,
        UNIQUE (sender_id, client_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friend_messages_friendship ON friend_messages(friendship_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_friend_messages_unread ON friend_messages(recipient_id, friendship_id) WHERE read_at IS NULL;
    `,
  },
  {
    // The distributed replacement for app/api/realtime/turn's previous
    // in-memory (per-process) rate limit — Vercel may run that route on
    // any of several serverless instances that share no memory with each
    // other, so an in-memory limiter there was never actually authoritative
    // across them. Same fixed-window-counter shape as migration
    // 0007_image_moderation_rate_limits (see its own comment for the full
    // reasoning behind that design) but kept as its own dedicated table,
    // one row per user_id: TURN credential issuance is a different
    // feature with its own (much simpler — no `surface` dimension) key,
    // and reusing image_moderation_rate_limits would muddy a table that's
    // already a different feature's own. See lib/db.ts's
    // checkAndIncrementTurnCredentialRateLimit for the atomic upsert that
    // reads and increments this in one round trip.
    id: "0010_turn_credential_rate_limits",
    sql: `
      CREATE TABLE IF NOT EXISTS turn_credential_rate_limits (
        user_id TEXT PRIMARY KEY,
        window_start BIGINT NOT NULL,
        count INTEGER NOT NULL
      );
    `,
  },
  {
    // Lets a friend-chat message reference the specific earlier message it's
    // replying to (see FriendsPanel.tsx's reply affordance and
    // lib/db.ts's sendFriendMessage()). Nullable — most messages reply to
    // nothing. Deliberately NOT a foreign key: the replied-to message can
    // never be deleted on its own (no per-message delete exists), but
    // NO ACTION here would only ever matter if one did, and a plain
    // nullable TEXT column is consistent with every other id reference
    // already in this table (friendship_id/sender_id/recipient_id are
    // exactly the same — logical references, no FK constraint).
    id: "0011_friend_message_replies",
    sql: `
      ALTER TABLE friend_messages ADD COLUMN reply_to_id TEXT;
    `,
  },
  {
    id: "0012_production_safety",
    sql: `
      CREATE TABLE api_rate_limits (key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, expires_at BIGINT NOT NULL, count INTEGER NOT NULL);
      CREATE INDEX api_rate_expiry ON api_rate_limits(expires_at);
      ALTER TABLE reports ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
      UPDATE reports SET priority='urgent' WHERE category='underage_concern';
      CREATE INDEX reports_priority ON reports(priority, status, created_at);
      CREATE TABLE privacy_operations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, created_at BIGINT NOT NULL);
      ALTER TABLE moderation_actions ADD COLUMN previous_state JSONB;
      ALTER TABLE blocks ADD CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id) NOT VALID;
      ALTER TABLE friendships ADD CONSTRAINT friendships_ordered CHECK (user_a_id < user_b_id) NOT VALID;
      ALTER TABLE friend_requests ADD CONSTRAINT requests_no_self CHECK (sender_id <> recipient_id) NOT VALID;
      ALTER TABLE friend_requests ADD CONSTRAINT requests_status CHECK (status IN ('pending','accepted','declined')) NOT VALID;
      ALTER TABLE reports ADD CONSTRAINT reports_category CHECK (category IN ('sexual_content','harassment','hate','scam','spam','underage_concern','violence','other')) NOT VALID;
      ALTER TABLE reports ADD CONSTRAINT reports_status CHECK (status IN ('pending','reviewed')) NOT VALID;
      ALTER TABLE friend_messages ADD CONSTRAINT messages_no_self CHECK (sender_id <> recipient_id) NOT VALID;
      CREATE UNIQUE INDEX friend_message_reply_identity ON friend_messages(friendship_id,id);
      ALTER TABLE friend_messages ADD CONSTRAINT replies_same_friendship FOREIGN KEY(friendship_id,reply_to_id) REFERENCES friend_messages(friendship_id,id) DEFERRABLE INITIALLY DEFERRED NOT VALID;
      ALTER TABLE user_posts ADD CONSTRAINT posts_owner FOREIGN KEY(user_id) REFERENCES users(id) NOT VALID;
      ALTER TABLE billing_customers ADD CONSTRAINT billing_owner FOREIGN KEY(user_id) REFERENCES users(id) NOT VALID;
      ALTER TABLE billing_subscriptions ADD CONSTRAINT subscription_owner FOREIGN KEY(user_id) REFERENCES users(id) NOT VALID;
    `,
  },
  {
    id: "0013_database_security_hardening",
    sql: `
      SET LOCAL lock_timeout = '5s';
      DO $hardening$
      DECLARE role_name text; creator text; object_kind text;
      BEGIN
        IF current_user IN ('anon', 'authenticated', 'authenticator') THEN
          RAISE EXCEPTION 'Migrations require the server database owner role';
        END IF;
        -- The existing migrator is the direct pg identity, not a Data API role.
        -- Preserve its access explicitly before removing inherited PUBLIC grants.
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', current_user);
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', current_user);
        EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', current_user);
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
          EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
          EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
          EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
        END LOOP;
        -- Defaults belong to the creating role. Cover existing public table owners
        -- and the migrator; refuse/roll back if we cannot secure an owner.
        FOR creator IN SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname='public'
                       UNION SELECT current_user LOOP
          FOREACH object_kind IN ARRAY ARRAY['TABLES','SEQUENCES','FUNCTIONS'] LOOP
            -- Global defaults are additive with schema defaults, so revoke both.
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON %s FROM PUBLIC', creator, object_kind);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM PUBLIC', creator, object_kind);
            FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
              EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON %s FROM %I', creator, object_kind, role_name);
              EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM %I', creator, object_kind, role_name);
            END LOOP;
          END LOOP;
        END LOOP;
        -- Catch inherited role grants as well as explicit grants. Never silently
        -- commit a partially secured schema or revoke unrelated role membership.
        IF EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN pg_roles r
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
          AND r.rolname IN ('anon','authenticated')
          AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
        ) THEN RAISE EXCEPTION 'Inherited or column Data API grants remain; owner review required'; END IF;
      END $hardening$;
    `,
  },
  {
    id: "0014_validate_production_constraints",
    sql: `
      SET LOCAL lock_timeout = '5s';
      CREATE INDEX IF NOT EXISTS friend_message_reply_lookup
        ON friend_messages(friendship_id, reply_to_id) WHERE reply_to_id IS NOT NULL;
      ALTER TABLE blocks VALIDATE CONSTRAINT blocks_no_self;
      ALTER TABLE friendships VALIDATE CONSTRAINT friendships_ordered;
      ALTER TABLE friend_requests VALIDATE CONSTRAINT requests_no_self;
      ALTER TABLE friend_requests VALIDATE CONSTRAINT requests_status;
      ALTER TABLE reports VALIDATE CONSTRAINT reports_category;
      ALTER TABLE reports VALIDATE CONSTRAINT reports_status;
      ALTER TABLE friend_messages VALIDATE CONSTRAINT messages_no_self;
      ALTER TABLE friend_messages VALIDATE CONSTRAINT replies_same_friendship;
      ALTER TABLE user_posts VALIDATE CONSTRAINT posts_owner;
      ALTER TABLE billing_customers VALIDATE CONSTRAINT billing_owner;
      ALTER TABLE billing_subscriptions VALIDATE CONSTRAINT subscription_owner;
    `,
  },
  {
    id: "0015_launch_evidence_retention",
    sql: `
      CREATE TABLE legal_holds (
        id TEXT PRIMARY KEY, case_reference TEXT NOT NULL, reason TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at BIGINT NOT NULL, released_at BIGINT,
        released_by TEXT, release_reason TEXT
      );
      -- A hold conservatively pauses ALL destructive processing. Scope narrowing
      -- requires a separately reviewed implementation, never guessed predicates.
      CREATE TABLE held_records (
        id BIGSERIAL PRIMARY KEY, table_name TEXT NOT NULL, record_id TEXT NOT NULL,
        snapshot JSONB NOT NULL, created_at BIGINT NOT NULL
      );
      CREATE INDEX held_record_lookup ON held_records(table_name,record_id);
      ALTER TABLE held_records ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON held_records FROM PUBLIC;
      CREATE FUNCTION preserve_held_record() RETURNS trigger LANGUAGE plpgsql AS $hold$
      DECLARE previous jsonb;
      BEGIN
        LOCK TABLE legal_holds IN SHARE MODE;
        IF EXISTS(SELECT 1 FROM legal_holds WHERE released_at IS NULL) THEN
          previous := to_jsonb(OLD);
          IF TG_OP='UPDATE' AND previous=to_jsonb(NEW) THEN RETURN NEW; END IF;
          IF NOT EXISTS(SELECT 1 FROM held_records WHERE table_name=TG_TABLE_NAME AND record_id=COALESCE(previous->>'id',previous->>'report_id') AND snapshot=previous) THEN
            INSERT INTO held_records(table_name,record_id,snapshot,created_at) VALUES(TG_TABLE_NAME,COALESCE(previous->>'id',previous->>'report_id'),previous,extract(epoch from clock_timestamp())*1000);
          END IF;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $hold$;
      REVOKE ALL ON FUNCTION preserve_held_record() FROM PUBLIC;
      CREATE TRIGGER preserve_users BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_posts BEFORE UPDATE OR DELETE ON user_posts FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_messages BEFORE UPDATE OR DELETE ON friend_messages FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_requests BEFORE UPDATE OR DELETE ON friend_requests FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_friends BEFORE UPDATE OR DELETE ON friendships FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_blocks BEFORE UPDATE OR DELETE ON blocks FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_acceptance BEFORE UPDATE OR DELETE ON legal_acceptance FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_reports BEFORE UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_actions BEFORE UPDATE OR DELETE ON moderation_actions FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_checks BEFORE UPDATE OR DELETE ON moderation_events FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_privacy BEFORE UPDATE OR DELETE ON privacy_operations FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      ALTER TABLE reports ADD COLUMN safety_state TEXT NOT NULL DEFAULT 'none' CHECK (safety_state IN ('none','open','closed'));
      UPDATE reports SET safety_state='open' WHERE category='underage_concern' AND status='pending';
      CREATE TABLE report_evidence (
        report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
        captured_at BIGINT NOT NULL, chat_context JSONB NOT NULL DEFAULT '[]',
        history JSONB NOT NULL DEFAULT '{}', screenshot_state TEXT NOT NULL DEFAULT 'not_captured',
        CHECK (screenshot_state='not_captured')
      );
      CREATE TABLE safety_decisions (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id),
        actor_id TEXT NOT NULL, decision TEXT NOT NULL, case_reference TEXT NOT NULL,
        rationale TEXT NOT NULL, external_reference TEXT, created_at BIGINT NOT NULL
      );
      CREATE TRIGGER preserve_evidence BEFORE UPDATE OR DELETE ON report_evidence FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_safety BEFORE UPDATE OR DELETE ON safety_decisions FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TABLE image_deletion_queue (
        reference TEXT PRIMARY KEY, created_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX image_deletion_due ON image_deletion_queue(next_attempt_at,created_at);
      CREATE FUNCTION queue_removed_image() RETURNS trigger LANGUAGE plpgsql AS $queue$
      DECLARE reference text;
      BEGIN
        IF TG_TABLE_NAME='users' THEN
          reference:=OLD.profile_photo;
          IF TG_OP='UPDATE' AND NEW.profile_photo IS NOT DISTINCT FROM OLD.profile_photo THEN RETURN NEW; END IF;
        ELSE reference:=OLD.data_url; END IF;
        IF reference LIKE '/api/media/%' THEN
          INSERT INTO image_deletion_queue(reference,created_at) VALUES(reference,extract(epoch from clock_timestamp())*1000) ON CONFLICT DO NOTHING;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $queue$;
      REVOKE ALL ON FUNCTION queue_removed_image() FROM PUBLIC;
      CREATE TRIGGER queue_profile_image AFTER UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION queue_removed_image();
      CREATE TRIGGER queue_post_image AFTER DELETE ON user_posts FOR EACH ROW EXECUTE FUNCTION queue_removed_image();
      ALTER TABLE privacy_operations ADD COLUMN retained JSONB;
      CREATE INDEX retention_messages ON friend_messages(created_at);
      CREATE INDEX retention_requests ON friend_requests(created_at);
      CREATE INDEX retention_reports ON reports(created_at);
      CREATE INDEX retention_actions ON moderation_actions(created_at);
      CREATE INDEX retention_privacy ON privacy_operations(created_at);
      CREATE INDEX retention_acceptance ON legal_acceptance(accepted_at);
      ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
      ALTER TABLE report_evidence ENABLE ROW LEVEL SECURITY;
      ALTER TABLE safety_decisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE image_deletion_queue ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON legal_holds, report_evidence, safety_decisions, image_deletion_queue FROM PUBLIC;

      -- Database enforcement closes races between status checks, erasure and
      -- product writes from separate web/realtime instances. Owner identity is
      -- still authenticated in application code; these are consistency guards.
      CREATE FUNCTION guard_product_identity() RETURNS trigger LANGUAGE plpgsql AS $guard$
      DECLARE ids text[]; account record;
      BEGIN
        IF TG_TABLE_NAME='user_posts' OR TG_TABLE_NAME='billing_subscriptions' THEN ids:=ARRAY[NEW.user_id];
        ELSIF TG_TABLE_NAME='friendships' THEN ids:=ARRAY[NEW.user_a_id, NEW.user_b_id];
        ELSE ids:=ARRAY[NEW.sender_id, NEW.recipient_id]; END IF;
        FOR account IN SELECT id,deleted_at,banned_at,suspended_until FROM users WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
          IF account.deleted_at IS NOT NULL OR account.banned_at IS NOT NULL OR account.suspended_until > extract(epoch from clock_timestamp())*1000 THEN
            RAISE EXCEPTION 'account_unavailable' USING ERRCODE='23514';
          END IF;
        END LOOP;
        IF (SELECT count(*) FROM users WHERE id=ANY(ids)) <> cardinality(ids) THEN RAISE EXCEPTION 'invalid_accounts' USING ERRCODE='23514'; END IF;
        IF cardinality(ids)=2 AND EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=ids[1] AND blocked_id=ids[2]) OR (blocker_id=ids[2] AND blocked_id=ids[1])) THEN
          RAISE EXCEPTION 'blocked' USING ERRCODE='23514';
        END IF;
        IF TG_TABLE_NAME='friend_messages' THEN
        IF NOT EXISTS(SELECT 1 FROM friendships WHERE id=NEW.friendship_id AND user_a_id=least(NEW.sender_id,NEW.recipient_id) AND user_b_id=greatest(NEW.sender_id,NEW.recipient_id)) THEN
          RAISE EXCEPTION 'not_friends' USING ERRCODE='23514';
        END IF;
        END IF;
        RETURN NEW;
      END $guard$;
      REVOKE ALL ON FUNCTION guard_product_identity() FROM PUBLIC;
      CREATE TRIGGER guard_posts BEFORE INSERT ON user_posts FOR EACH ROW EXECUTE FUNCTION guard_product_identity();
      CREATE TRIGGER guard_subscription BEFORE INSERT OR UPDATE ON billing_subscriptions FOR EACH ROW EXECUTE FUNCTION guard_product_identity();
      CREATE TRIGGER guard_friendship BEFORE INSERT ON friendships FOR EACH ROW EXECUTE FUNCTION guard_product_identity();
      CREATE TRIGGER guard_request BEFORE INSERT ON friend_requests FOR EACH ROW EXECUTE FUNCTION guard_product_identity();
      CREATE TRIGGER guard_message BEFORE INSERT ON friend_messages FOR EACH ROW EXECUTE FUNCTION guard_product_identity();
      CREATE FUNCTION guard_erased_profile() RETURNS trigger LANGUAGE plpgsql AS $guard$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND (NEW.username IS NOT NULL OR NEW.gender IS NOT NULL OR NEW.profile_photo IS NOT NULL OR COALESCE(NEW.bio,'') <> '') THEN
          RAISE EXCEPTION 'account_deleted' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $guard$;
      REVOKE ALL ON FUNCTION guard_erased_profile() FROM PUBLIC;
      CREATE TRIGGER guard_profile BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_erased_profile();
    `,
  },
  {
    // Safety reporting after a room ends and accountable moderation appeals.
    // These tables are application-server only: normal clients never receive
    // counterpart account ids or confidential moderation notes.
    id: "0016_recent_matches_appeals",
    sql: `
      CREATE TABLE match_sessions (
        id TEXT PRIMARY KEY,
        user_a_id TEXT NOT NULL,
        user_b_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('random','friend')),
        started_at BIGINT NOT NULL,
        ended_at BIGINT,
        report_eligible_until BIGINT NOT NULL,
        CHECK (user_a_id < user_b_id),
        CHECK (ended_at IS NULL OR ended_at >= started_at),
        CHECK (report_eligible_until >= started_at)
      );
      CREATE INDEX match_sessions_user_a_recent ON match_sessions(user_a_id, started_at DESC);
      CREATE INDEX match_sessions_user_b_recent ON match_sessions(user_b_id, started_at DESC);
      CREATE INDEX match_sessions_retention ON match_sessions(started_at);
      CREATE INDEX reports_match_reporter ON reports(match_id, reporter_id) WHERE match_id IS NOT NULL;

      ALTER TABLE moderation_actions ADD CONSTRAINT moderation_action_valid
        CHECK (action IN ('no_action','warning','restrict','suspend','ban')) NOT VALID;
      ALTER TABLE moderation_actions VALIDATE CONSTRAINT moderation_action_valid;

      CREATE TABLE appeals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        enforcement_id TEXT NOT NULL REFERENCES moderation_actions(id),
        reason TEXT NOT NULL,
        evidence_reference TEXT,
        submitted_at BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted'
          CHECK (status IN ('submitted','under_review','upheld','overturned','dismissed')),
        reviewing_admin_id TEXT,
        resolution TEXT,
        resolved_at BIGINT,
        CHECK (length(reason) BETWEEN 1 AND 2000),
        CHECK (evidence_reference IS NULL OR length(evidence_reference) <= 500),
        CHECK (resolution IS NULL OR length(resolution) <= 2000),
        CHECK (
          (status IN ('submitted','under_review') AND resolved_at IS NULL)
          OR (status IN ('upheld','overturned','dismissed') AND resolved_at IS NOT NULL AND reviewing_admin_id IS NOT NULL AND resolution IS NOT NULL)
        )
      );
      CREATE UNIQUE INDEX one_open_appeal_per_enforcement
        ON appeals(enforcement_id) WHERE status IN ('submitted','under_review');
      CREATE INDEX appeals_user_recent ON appeals(user_id, submitted_at DESC);
      CREATE INDEX appeals_enforcement ON appeals(enforcement_id);
      CREATE INDEX appeals_queue ON appeals(status, submitted_at);
      CREATE INDEX appeals_retention ON appeals(submitted_at);

      ALTER TABLE report_evidence DROP CONSTRAINT IF EXISTS report_evidence_screenshot_state_check;
      ALTER TABLE report_evidence
        ADD COLUMN evidence_key TEXT,
        ADD COLUMN evidence_sha256 TEXT,
        ADD COLUMN evidence_deleted_at BIGINT,
        ADD CONSTRAINT report_evidence_capture_state CHECK (
          (screenshot_state = 'not_captured' AND evidence_key IS NULL AND evidence_sha256 IS NULL)
          OR (screenshot_state = 'captured' AND evidence_key IS NOT NULL AND evidence_sha256 ~ '^[0-9a-f]{64}$' AND evidence_deleted_at IS NULL)
          OR (screenshot_state = 'deleted' AND evidence_key IS NULL AND evidence_sha256 IS NOT NULL AND evidence_deleted_at IS NOT NULL)
        );

      CREATE TRIGGER preserve_match_sessions BEFORE UPDATE OR DELETE ON match_sessions
        FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      CREATE TRIGGER preserve_appeals BEFORE UPDATE OR DELETE ON appeals
        FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      ALTER TABLE match_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON match_sessions, appeals FROM PUBLIC;
    `,
  },
  {
    // Operator-entered U.S. child-safety reporting decisions. No report or
    // preservation row is created merely because a user selected the
    // underage category, and the application never submits to CyberTipline.
    id: "0017_cybertipline_preservation",
    sql: `
      CREATE TABLE cybertipline_cases (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL UNIQUE REFERENCES reports(id),
        case_reference TEXT NOT NULL UNIQUE,
        reviewer_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('not_required','manual_report_required','manual_report_submitted')),
        rationale TEXT NOT NULL,
        decided_at BIGINT NOT NULL,
        submitted_at BIGINT,
        receipt_reference TEXT,
        preservation_status TEXT NOT NULL CHECK (preservation_status IN ('not_started','active','expired','released')),
        preservation_expires_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CHECK (
          (decision <> 'manual_report_submitted' AND submitted_at IS NULL AND receipt_reference IS NULL AND preservation_status='not_started' AND preservation_expires_at IS NULL)
          OR
          (decision = 'manual_report_submitted' AND submitted_at IS NOT NULL AND receipt_reference IS NOT NULL AND length(receipt_reference) BETWEEN 1 AND 500 AND preservation_status='active' AND preservation_expires_at >= submitted_at + 31536000000)
        )
      );
      CREATE INDEX cybertipline_preservation_due ON cybertipline_cases(preservation_expires_at) WHERE preservation_status='active';
      CREATE INDEX cybertipline_case_updated ON cybertipline_cases(updated_at);
      CREATE FUNCTION guard_cybertipline_preservation() RETURNS trigger LANGUAGE plpgsql AS $preservation$
      BEGIN
        IF OLD.preservation_status='active' AND OLD.preservation_expires_at>extract(epoch from clock_timestamp())*1000
          AND (NEW.preservation_status<>'active' OR NEW.preservation_expires_at<OLD.preservation_expires_at) THEN
          RAISE EXCEPTION 'active_cybertipline_preservation' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $preservation$;
      REVOKE ALL ON FUNCTION guard_cybertipline_preservation() FROM PUBLIC;
      CREATE TRIGGER guard_cybertipline_preservation BEFORE UPDATE ON cybertipline_cases
        FOR EACH ROW EXECUTE FUNCTION guard_cybertipline_preservation();
      CREATE TRIGGER preserve_cybertipline_cases BEFORE UPDATE OR DELETE ON cybertipline_cases
        FOR EACH ROW EXECUTE FUNCTION preserve_held_record();
      ALTER TABLE cybertipline_cases ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON cybertipline_cases FROM PUBLIC;
    `,
  },

]
