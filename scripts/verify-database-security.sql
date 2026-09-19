-- Run using EACH actual Vercel/Railway DATABASE_URL (never print it).
-- Read-only: fails if any effective Data API table/column access remains.
DO $verify$
DECLARE r record; t record; p text;
BEGIN
  IF current_user IN ('anon','authenticated','authenticator') THEN RAISE EXCEPTION 'Not the server role'; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')) <> 2 THEN RAISE EXCEPTION 'Expected Data API roles missing'; END IF;
  FOR r IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    FOR t IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
      IF has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Data API table access remains';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND CASE WHEN relkind='S' THEN has_sequence_privilege(r.oid,oid,'USAGE,SELECT,UPDATE') ELSE false END)
      OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND has_function_privilege(r.oid,oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'Data API sequence/function access remains';
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    FOR t IN SELECT c.oid FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
      IF NOT has_table_privilege(current_user,t.oid,p) THEN RAISE EXCEPTION 'Server table access missing'; END IF;
    END LOOP;
  END LOOP;
  PERFORM 1 FROM public.users LIMIT 1;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) THEN RAISE EXCEPTION 'Unvalidated constraints remain'; END IF;
END $verify$;
SELECT 'database_security_verified' AS result;
