\set ON_ERROR_STOP off
\pset pager off
\echo '--- register: seat 1 admin, seat 2 standard, seat 3 must fail (max 2)'
SELECT public.sa_register('Gov@Example.com','$argon2id$stub','LIC-1','Office A',2,NULL);
SELECT public.sa_register('staff@example.com','$argon2id$stub','LIC-1','Office A',2,NULL);
SELECT public.sa_register('third@example.com','$argon2id$stub','LIC-1','Office A',2,NULL);
\echo '--- duplicate email must fail and NOT burn a seat (use LIC-2 max 2)'
SELECT public.sa_register('dup@example.com','h','LIC-2','B',2,NULL);
SELECT public.sa_register('DUP@example.com','h','LIC-2','B',2,NULL);
SELECT public.sa_register('ok2@example.com','h','LIC-2','B',2,NULL);
\echo '--- expired license rejected'
SELECT public.sa_register('old@example.com','h','LIC-3','C',1,now()-interval '1 day');
\echo '--- lookup normalises case'
SELECT public.sa_user_get_by_email('GOV@EXAMPLE.COM')->>'role' AS role, public.sa_user_get_by_email('gov@example.com')->>'failed_attempts' AS fa;
\echo '--- lockout after 3 failures (max=3)'
SELECT public.sa_login_failed((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid,3,15) AS l1;
SELECT public.sa_login_failed((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid,3,15) AS l2;
SELECT public.sa_login_failed((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid,3,15) IS NOT NULL AS locked;
SELECT public.sa_login_ok((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid);
SELECT public.sa_user_get_by_email('gov@example.com')->>'failed_attempts' AS fa_after_ok;
\echo '--- sessions'
SELECT public.sa_session_create((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, sha256('tok1'::bytea), 3600, 2) IS NOT NULL AS s1;
SELECT public.sa_session_get(sha256('tok1'::bytea))->>'email' AS valid_session;
SELECT public.sa_session_get(sha256('wrong'::bytea)) IS NULL AS bad_token_rejected;
SELECT public.sa_session_create((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, sha256('tok2'::bytea), 3600, 2) IS NOT NULL;
SELECT public.sa_session_create((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, sha256('tok3'::bytea), 3600, 2) IS NOT NULL;
SELECT public.sa_session_get(sha256('tok1'::bytea)) IS NULL AS oldest_evicted_at_cap2;
SELECT public.sa_session_revoke(sha256('tok3'::bytea));
SELECT public.sa_session_get(sha256('tok3'::bytea)) IS NULL AS revoked_rejected;
SELECT public.sa_session_get(sha256('tok2'::bytea), 0) IS NULL AS idle_timeout_rejected;
\echo '--- records: shared corpus + private; scoping'
SELECT public.sa_records_upsert(NULL, '[{"source_origin":"constitution","category":"constitution","payload":{"id":"const-1","title":"Constitution","url":"https://constitution.congress.gov/","jurisdiction":"federal","category":"constitution","retrieved_at":"2026-10-21T00:00:00Z","text":"We the People of the United States, in Order to form a more perfect Union, establish Justice, insure domestic Tranquility"}}]'::jsonb) AS shared_n;
SELECT public.sa_records_upsert((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, '[{"source_origin":"notes","category":"policy","payload":{"id":"private-1","title":"Gov private memo","url":"https://example.org/memo","jurisdiction":"Maryland","text":"Confidential justice reform memo for the governor"}}]'::jsonb) AS private_n;
SELECT public.sa_records_upsert(NULL, '[{"source_origin":"constitution","category":"constitution","payload":{"id":"const-1","title":"Constitution v2","url":"https://constitution.congress.gov/","jurisdiction":"federal","text":"We the People ... establish Justice (updated)"}}]'::jsonb) AS idempotent_update_n;
SELECT count(*) AS rows_after_reupsert FROM core."Ⅰↂↇⅴ";
SELECT jsonb_array_length(public.sa_records_search((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, 'justice', NULL, 4)) AS gov_sees;
SELECT jsonb_array_length(public.sa_records_search((public.sa_user_get_by_email('staff@example.com')->>'user_id')::uuid, 'justice', NULL, 4)) AS staff_sees_only_shared;
SELECT jsonb_array_length(public.sa_records_search((public.sa_user_get_by_email('gov@example.com')->>'user_id')::uuid, 'justice', 'maryland', 4)) AS jurisdiction_filter;
\echo '--- validation rejects http url / oversize / missing title'
SELECT public.sa_records_upsert(NULL, '[{"source_origin":"x","category":"y","payload":{"id":"bad","title":"t","url":"http://insecure","text":"x"}}]'::jsonb);
\echo '--- deleting a user removes their private records (no leak into shared corpus)'
DELETE FROM core."ⅨↂⅭ" WHERE "Ⅻↁ" = 'gov@example.com';
SELECT count(*) AS rows_after_user_delete, count(*) FILTER (WHERE "ⅫↃⅷ" IS NULL) AS shared_rows FROM core."Ⅰↂↇⅴ";
\echo '--- audit chain'
SELECT public.sa_audit(NULL,'login','{"ip":"x"}'::jsonb) > 0;
SELECT public.sa_audit(NULL,'chat','{}'::jsonb) > 0;
SELECT public.sa_audit_verify();
UPDATE core."ⅢⅾⅠↃↃ" SET "ⅿⅾⅵⅠ" = '{}' WHERE "ⅥⅩⅹⅾⅲ" = 1;
DELETE FROM core."ⅢⅾⅠↃↃ";
TRUNCATE core."ⅢⅾⅠↃↃ";
\echo '--- tamper with chain as superuser (disable trigger) -> verify must catch'
ALTER TABLE core."ⅢⅾⅠↃↃ" DISABLE TRIGGER audit_no_mutation;
UPDATE core."ⅢⅾⅠↃↃ" SET "ⅿⅾⅵⅠ" = '{"ip":"forged"}' WHERE "ⅥⅩⅹⅾⅲ" = 1;
SELECT public.sa_audit_verify();
ALTER TABLE core."ⅢⅾⅠↃↃ" ENABLE TRIGGER audit_no_mutation;
\echo '--- privileges: anon/authenticated cannot call API or read core; service_role can call API'
SET ROLE anon;
SELECT public.sa_user_get_by_email('staff@example.com');
SELECT * FROM core."ⅨↂⅭ";
RESET ROLE;
SET ROLE authenticated;
SELECT public.sa_records_search(NULL,'justice');
RESET ROLE;
SET ROLE service_role;
SELECT public.sa_user_get_by_email('staff@example.com')->>'email' AS service_ok;
SELECT * FROM core."ⅨↂⅭ";
RESET ROLE;
