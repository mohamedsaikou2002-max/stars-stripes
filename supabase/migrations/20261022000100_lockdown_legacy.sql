-- Lock down every inherited table. The original app was single-operator with
-- "USING (true)" policies and no auth. After this migration the browser (anon /
-- authenticated roles) has NO direct table access: all reads/writes go through
-- Edge Functions, which authenticate a session and use the service role.

-- 1. Remove every permissive policy in public and make sure RLS is on.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 2. Revoke table/sequence/function privileges from the browser-facing roles.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $$;

-- 3. Move the civic corpus into the obfuscated retrieval store, then retire the old table/RPC.
DO $$ BEGIN
  IF to_regclass('public.civic_passages') IS NOT NULL THEN
    PERFORM public.sa_records_upsert(NULL, coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source_origin', left(split_part(p.id, '-', 1), 100),
        'category', p.category,
        'payload', jsonb_build_object('id', p.id, 'title', p.title, 'url', p.url,
                                      'jurisdiction', p.jurisdiction, 'category', p.category,
                                      'retrieved_at', p.retrieved_at, 'text', p.text)))
        FROM (SELECT * FROM public.civic_passages ORDER BY id LIMIT 500) p), '[]'::jsonb));
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.search_civic_passages(text, text, integer);
DROP TABLE IF EXISTS public.civic_passages;

-- 4. Per-account ownership is by user_id (TEXT, holds the authenticated user's UUID).
--    Add helpful indexes the new per-user queries rely on.
CREATE INDEX IF NOT EXISTS mirofish_sims_user_updated_idx ON public.mirofish_sims (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS eagle_eye_targets_user_idx ON public.eagle_eye_targets (user_id, created_at DESC);
