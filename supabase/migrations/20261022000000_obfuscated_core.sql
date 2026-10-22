-- =====================================================================
-- Stars and Stripes — obfuscated core schema (GENERATED from core.sql.tmpl)
-- Edit the template, then:  python -m schema_obfuscation render ...
-- Physical identifiers use the antique-numeral profile; the application never
-- touches these tables directly — only the SECURITY DEFINER sa_* functions
-- below, callable by service_role alone. The schema is private (not exposed
-- through PostgREST) and unreachable by anon/authenticated.
-- Obfuscation hides intent from casual dump readers; it is not access control.
-- =====================================================================

-- Enable extension
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS "core";
REVOKE ALL ON SCHEMA "core" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA "core" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA "core" FROM authenticated';
  END IF;
END $$;

-- Table: auth_users
CREATE TABLE IF NOT EXISTS "core"."ⅨↂⅭ" (
    "ⅴⅵⅬ" UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    "Ⅻↁ" VARCHAR(255) UNIQUE NOT NULL,
    "ⅢↈⅯⅶ" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'standard_user',
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Additive hardening columns (original columns above are unchanged).
ALTER TABLE "core"."ⅨↂⅭ"
    ADD COLUMN IF NOT EXISTS "ↇⅴⅥ" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "ⅼⅯↈⅸⅡ" TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS "ↅⅺⅩ" TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS "ⅠↅⅩↂ" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_role_chk') THEN
    ALTER TABLE "core"."ⅨↂⅭ" ADD CONSTRAINT auth_users_role_chk CHECK ("role" IN ('standard_user','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_email_lower_chk') THEN
    ALTER TABLE "core"."ⅨↂⅭ" ADD CONSTRAINT auth_users_email_lower_chk CHECK ("Ⅻↁ" = lower("Ⅻↁ"));
  END IF;
END $$;

-- Table: licenses (vendor-signed license tokens are verified in the edge function; this tracks seat use)
CREATE TABLE IF NOT EXISTS "core"."ↅⅲↂ" (
    "ⅠↅⅩↂ" TEXT PRIMARY KEY,
    "ⅥⅡⅻↃↄ" TEXT NOT NULL,
    "ↆↇↀↇↀ" INTEGER NOT NULL CHECK ("ↆↇↀↇↀ" BETWEEN 1 AND 1000),
    "ⅴⅧⅲ" INTEGER NOT NULL DEFAULT 0 CHECK ("ⅴⅧⅲ" >= 0),
    "ⅡⅬⅱ" TIMESTAMP WITH TIME ZONE,
    "ↀⅫⅦⅢ" TIMESTAMP WITH TIME ZONE,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT licenses_seats_chk CHECK ("ⅴⅧⅲ" <= "ↆↇↀↇↀ")
);

-- Table: sessions (only a SHA-256 of the opaque bearer token is stored)
CREATE TABLE IF NOT EXISTS "core"."ⅵⅬⅯⅪ" (
    "ⅾⅺↈⅿⅿ" UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    "ↅↂↄⅦ" BYTEA UNIQUE NOT NULL,
    "ⅴⅵⅬ" UUID NOT NULL REFERENCES "core"."ⅨↂⅭ"("ⅴⅵⅬ") ON DELETE CASCADE,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "ⅡⅬⅱ" TIMESTAMP WITH TIME ZONE NOT NULL,
    "ↄⅾↇⅦⅣ" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ↀⅫⅦⅢ" TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_obf_sessions_user ON "core"."ⅵⅬⅯⅪ"("ⅴⅵⅬ");

-- Table: retrieval_records
-- NOTE: owner FK is ON DELETE CASCADE (was SET NULL). With SET NULL a deleted
-- account's private rows would become owner-less, i.e. visible to every account.
CREATE TABLE IF NOT EXISTS "core"."Ⅰↂↇⅴ" (
    "ⅭⅮⅿ" UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    "ⅫↃⅷ" UUID REFERENCES "core"."ⅨↂⅭ"("ⅴⅵⅬ") ON DELETE CASCADE, -- NULL = shared corpus
    "ⅵↂⅷ" VARCHAR(100) NOT NULL,
    "Ⅳⅹↅ" VARCHAR(100) NOT NULL,
    "ⅯⅭⅮ" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "search_vector" TSVECTOR,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing using symbol columns
CREATE INDEX IF NOT EXISTS idx_obf_payload ON "core"."Ⅰↂↇⅴ" USING gin ("ⅯⅭⅮ");
CREATE INDEX IF NOT EXISTS idx_obf_owner ON "core"."Ⅰↂↇⅴ"("ⅫↃⅷ");
CREATE INDEX IF NOT EXISTS idx_obf_search ON "core"."Ⅰↂↇⅴ" USING gin ("search_vector");
CREATE UNIQUE INDEX IF NOT EXISTS idx_obf_record_identity ON "core"."Ⅰↂↇⅴ"
    ((coalesce("ⅫↃⅷ", '00000000-0000-0000-0000-000000000000'::uuid)), (("ⅯⅭⅮ"->>'id')));

CREATE OR REPLACE FUNCTION "core".retrieval_vector() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW."search_vector" := to_tsvector('english',
    coalesce(NEW."ⅯⅭⅮ"->>'title','') || ' ' || coalesce(NEW."ⅯⅭⅮ"->>'text',''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS retrieval_vector_trg ON "core"."Ⅰↂↇⅴ";
CREATE TRIGGER retrieval_vector_trg BEFORE INSERT OR UPDATE ON "core"."Ⅰↂↇⅴ"
    FOR EACH ROW EXECUTE FUNCTION "core".retrieval_vector();

-- Table: audit_log (append-only, hash-chained)
CREATE TABLE IF NOT EXISTS "core"."ⅢⅾⅠↃↃ" (
    "ⅥⅩⅹⅾⅲ" BIGSERIAL PRIMARY KEY,
    "ⅴⅵⅬ" UUID,                      -- deliberately no FK: the trail outlives accounts
    "ↈⅫⅭⅺⅩ" TEXT NOT NULL,
    "ⅿⅾⅵⅠ" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "Ⅴⅱↇⅾ" BYTEA,
    "ⅩⅼⅮⅶ" BYTEA NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE OR REPLACE FUNCTION "core".audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'SA009'; END $$;
DROP TRIGGER IF EXISTS audit_no_mutation ON "core"."ⅢⅾⅠↃↃ";
CREATE TRIGGER audit_no_mutation BEFORE UPDATE OR DELETE ON "core"."ⅢⅾⅠↃↃ"
    FOR EACH ROW EXECUTE FUNCTION "core".audit_immutable();
DROP TRIGGER IF EXISTS audit_no_truncate ON "core"."ⅢⅾⅠↃↃ";
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "core"."ⅢⅾⅠↃↃ"
    FOR EACH STATEMENT EXECUTE FUNCTION "core".audit_immutable();

-- Defence in depth: RLS on with no policies = non-owner roles see nothing.
ALTER TABLE "core"."ⅨↂⅭ" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."ↅⅲↂ" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."ⅵⅬⅯⅪ" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."Ⅰↂↇⅴ" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."ⅢⅾⅠↃↃ" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Service API (RPC). Clear-text names outside, symbols inside.
-- =====================================================================

-- Registration: seat claim + account creation are one atomic step.
-- The first account on a license is its admin.
CREATE OR REPLACE FUNCTION public.sa_register(
  p_email text, p_password_hash text, p_license_id text, p_holder text,
  p_max_accounts integer, p_expires timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_used integer; v_uid uuid; v_role text;
BEGIN
  IF p_expires IS NOT NULL AND p_expires <= now() THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = 'SA003';
  END IF;
  INSERT INTO "core"."ↅⅲↂ" ("ⅠↅⅩↂ", "ⅥⅡⅻↃↄ", "ↆↇↀↇↀ", "ⅡⅬⅱ")
  VALUES (p_license_id, p_holder, p_max_accounts, p_expires)
  ON CONFLICT ("ⅠↅⅩↂ") DO NOTHING;
  UPDATE "core"."ↅⅲↂ" SET "ⅴⅧⅲ" = "ⅴⅧⅲ" + 1
   WHERE "ⅠↅⅩↂ" = p_license_id AND "ↀⅫⅦⅢ" IS NULL
     AND "ⅴⅧⅲ" < "ↆↇↀↇↀ"
  RETURNING "ⅴⅧⅲ" INTO v_used;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'license_unavailable' USING ERRCODE = 'SA001';
  END IF;
  v_role := CASE WHEN v_used = 1 THEN 'admin' ELSE 'standard_user' END;
  INSERT INTO "core"."ⅨↂⅭ" ("Ⅻↁ", "ⅢↈⅯⅶ", "role", "ⅠↅⅩↂ")
  VALUES (lower(p_email), p_password_hash, v_role, p_license_id)
  RETURNING "ⅴⅵⅬ" INTO v_uid;   -- duplicate email raises 23505 and rolls the seat back
  RETURN jsonb_build_object('user_id', v_uid, 'role', v_role);
END $$;

CREATE OR REPLACE FUNCTION public.sa_user_get_by_email(p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
      'user_id', u."ⅴⅵⅬ", 'email', u."Ⅻↁ", 'password_hash', u."ⅢↈⅯⅶ",
      'role', u."role", 'is_active', u."is_active",
      'failed_attempts', u."ↇⅴⅥ", 'locked_until', u."ⅼⅯↈⅸⅡ")
    FROM "core"."ⅨↂⅭ" u WHERE u."Ⅻↁ" = lower(p_email);
$$;

CREATE OR REPLACE FUNCTION public.sa_login_failed(p_user uuid, p_max integer DEFAULT 5, p_lock_minutes integer DEFAULT 15)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_until timestamptz;
BEGIN
  UPDATE "core"."ⅨↂⅭ"
     SET "ↇⅴⅥ" = "ↇⅴⅥ" + 1,
         "ⅼⅯↈⅸⅡ" = CASE WHEN "ↇⅴⅥ" + 1 >= p_max
                                   THEN now() + make_interval(mins => p_lock_minutes)
                                   ELSE "ⅼⅯↈⅸⅡ" END
   WHERE "ⅴⅵⅬ" = p_user
  RETURNING "ⅼⅯↈⅸⅡ" INTO v_until;
  RETURN v_until;
END $$;

CREATE OR REPLACE FUNCTION public.sa_login_ok(p_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE "core"."ⅨↂⅭ"
     SET "ↇⅴⅥ" = 0, "ⅼⅯↈⅸⅡ" = NULL, "ↅⅺⅩ" = now()
   WHERE "ⅴⅵⅬ" = p_user;
$$;

CREATE OR REPLACE FUNCTION public.sa_set_password(p_user uuid, p_password_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE "core"."ⅨↂⅭ" SET "ⅢↈⅯⅶ" = p_password_hash, "ↇⅴⅥ" = 0, "ⅼⅯↈⅸⅡ" = NULL
   WHERE "ⅴⅵⅬ" = p_user;
  UPDATE "core"."ⅵⅬⅯⅪ" SET "ↀⅫⅦⅢ" = now() WHERE "ⅴⅵⅬ" = p_user AND "ↀⅫⅦⅢ" IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sa_session_create(p_user uuid, p_token_hash bytea, p_ttl_seconds integer DEFAULT 43200, p_max_sessions integer DEFAULT 5)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sid uuid;
BEGIN
  INSERT INTO "core"."ⅵⅬⅯⅪ" ("ↅↂↄⅦ", "ⅴⅵⅬ", "ⅡⅬⅱ")
  VALUES (p_token_hash, p_user, now() + make_interval(secs => p_ttl_seconds))
  RETURNING "ⅾⅺↈⅿⅿ" INTO v_sid;
  -- keep only the newest p_max_sessions live sessions per account
  UPDATE "core"."ⅵⅬⅯⅪ" SET "ↀⅫⅦⅢ" = now()
   WHERE "ⅾⅺↈⅿⅿ" IN (
     SELECT "ⅾⅺↈⅿⅿ" FROM "core"."ⅵⅬⅯⅪ"
      WHERE "ⅴⅵⅬ" = p_user AND "ↀⅫⅦⅢ" IS NULL
      ORDER BY "created_at" DESC OFFSET p_max_sessions);
  RETURN v_sid;
END $$;

CREATE OR REPLACE FUNCTION public.sa_session_get(p_token_hash bytea, p_idle_seconds integer DEFAULT 28800)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  SELECT s."ⅾⅺↈⅿⅿ" AS sid, s."ⅴⅵⅬ" AS uid, u."Ⅻↁ" AS em, u."role" AS rl, s."ↄⅾↇⅦⅣ" AS seen
    INTO r
    FROM "core"."ⅵⅬⅯⅪ" s
    JOIN "core"."ⅨↂⅭ" u ON u."ⅴⅵⅬ" = s."ⅴⅵⅬ"
   WHERE s."ↅↂↄⅦ" = p_token_hash
     AND s."ↀⅫⅦⅢ" IS NULL
     AND s."ⅡⅬⅱ" > now()
     AND s."ↄⅾↇⅦⅣ" > now() - make_interval(secs => p_idle_seconds)
     AND u."is_active";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.seen < now() - interval '60 seconds' THEN
    UPDATE "core"."ⅵⅬⅯⅪ" SET "ↄⅾↇⅦⅣ" = now() WHERE "ⅾⅺↈⅿⅿ" = r.sid;
  END IF;
  RETURN jsonb_build_object('session_id', r.sid, 'user_id', r.uid, 'email', r.em, 'role', r.rl);
END $$;

CREATE OR REPLACE FUNCTION public.sa_session_revoke(p_token_hash bytea)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE "core"."ⅵⅬⅯⅪ" SET "ↀⅫⅦⅢ" = now() WHERE "ↅↂↄⅦ" = p_token_hash AND "ↀⅫⅦⅢ" IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.sa_session_revoke_all(p_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE "core"."ⅵⅬⅯⅪ" SET "ↀⅫⅦⅢ" = now() WHERE "ⅴⅵⅬ" = p_user AND "ↀⅫⅦⅢ" IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.sa_purge_expired()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "core"."ⅵⅬⅯⅪ"
   WHERE "ⅡⅬⅱ" < now() - interval '30 days' OR "ↀⅫⅦⅢ" < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Corpus import (shared corpus when p_owner IS NULL). Idempotent per (owner, payload.id).
CREATE OR REPLACE FUNCTION public.sa_records_upsert(p_owner uuid, p_records jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) > 500 THEN
    RAISE EXCEPTION 'p_records must be a JSON array of at most 500 items' USING ERRCODE = 'SA010';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_records) r
     WHERE jsonb_typeof(r->'payload') <> 'object'
        OR coalesce(r->'payload'->>'id','') = ''
        OR coalesce(r->'payload'->>'title','') = ''
        OR coalesce(r->'payload'->>'url','') NOT LIKE 'https://%'
        OR length(coalesce(r->'payload'->>'text','')) NOT BETWEEN 1 AND 10000
        OR coalesce(r->>'source_origin','') = '' OR coalesce(r->>'category','') = ''
  ) THEN
    RAISE EXCEPTION 'record failed validation (id, title, https url, text 1..10000 chars, source_origin, category)' USING ERRCODE = 'SA010';
  END IF;
  INSERT INTO "core"."Ⅰↂↇⅴ" ("ⅫↃⅷ", "ⅵↂⅷ", "Ⅳⅹↅ", "ⅯⅭⅮ")
  SELECT p_owner, left(r->>'source_origin', 100), left(r->>'category', 100), r->'payload'
    FROM jsonb_array_elements(p_records) r
  ON CONFLICT ((coalesce("ⅫↃⅷ", '00000000-0000-0000-0000-000000000000'::uuid)), (("ⅯⅭⅮ"->>'id')))
  DO UPDATE SET "ⅵↂⅷ" = EXCLUDED."ⅵↂⅷ",
                "Ⅳⅹↅ" = EXCLUDED."Ⅳⅹↅ",
                "ⅯⅭⅮ" = EXCLUDED."ⅯⅭⅮ";
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Retrieval for the advisor: shared corpus plus the caller's own private records.
CREATE OR REPLACE FUNCTION public.sa_records_search(p_user uuid, p_query text, p_jurisdiction text DEFAULT NULL, p_limit integer DEFAULT 4)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(x.pl), '[]'::jsonb) FROM (
    SELECT r."ⅯⅭⅮ" AS pl
      FROM "core"."Ⅰↂↇⅴ" r
     WHERE r."search_vector" @@ websearch_to_tsquery('english', left(p_query, 1000))
       AND (r."ⅫↃⅷ" IS NULL OR r."ⅫↃⅷ" = p_user)
       AND (p_jurisdiction IS NULL OR lower(r."ⅯⅭⅮ"->>'jurisdiction') = lower(p_jurisdiction))
     ORDER BY ts_rank(r."search_vector", websearch_to_tsquery('english', left(p_query, 1000))) DESC
     LIMIT greatest(1, least(p_limit, 8))
  ) x;
$$;

-- Tamper-evident audit trail.
CREATE OR REPLACE FUNCTION public.sa_audit(p_user uuid, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prev bytea; v_ts timestamptz := clock_timestamp(); v_id bigint; v_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(727274);
  SELECT a."ⅩⅼⅮⅶ" INTO v_prev FROM "core"."ⅢⅾⅠↃↃ" a ORDER BY a."ⅥⅩⅹⅾⅲ" DESC LIMIT 1;
  v_hash := sha256(convert_to(
      coalesce(encode(v_prev, 'hex'), '') || '|' || coalesce(p_user::text, '') || '|' || p_action || '|' ||
      p_detail::text || '|' || to_char(v_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'UTF8'));
  INSERT INTO "core"."ⅢⅾⅠↃↃ" ("ⅴⅵⅬ", "ↈⅫⅭⅺⅩ", "ⅿⅾⅵⅠ", "Ⅴⅱↇⅾ", "ⅩⅼⅮⅶ", "created_at")
  VALUES (p_user, p_action, p_detail, v_prev, v_hash, v_ts)
  RETURNING "ⅥⅩⅹⅾⅲ" INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_audit_verify()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_prev bytea := NULL; v_expect bytea; v_count bigint := 0;
BEGIN
  FOR r IN SELECT * FROM "core"."ⅢⅾⅠↃↃ" ORDER BY "ⅥⅩⅹⅾⅲ" LOOP
    v_expect := sha256(convert_to(
        coalesce(encode(v_prev, 'hex'), '') || '|' || coalesce(r."ⅴⅵⅬ"::text, '') || '|' || r."ↈⅫⅭⅺⅩ" || '|' ||
        r."ⅿⅾⅵⅠ"::text || '|' || to_char(r."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'UTF8'));
    IF r."Ⅴⅱↇⅾ" IS DISTINCT FROM v_prev OR r."ⅩⅼⅮⅶ" <> v_expect THEN
      RETURN jsonb_build_object('ok', false, 'first_bad_event', r."ⅥⅩⅹⅾⅲ", 'checked', v_count);
    END IF;
    v_prev := r."ⅩⅼⅮⅶ";
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'checked', v_count);
END $$;

-- Only service_role may call the service API.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'sa\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;
