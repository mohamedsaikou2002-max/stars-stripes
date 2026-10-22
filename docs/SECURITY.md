# Stars and Stripes — security architecture

## Browser traffic monitor (current development scope)

`/eagle-view` is a database-independent, local security dashboard backed by native Node HTTP middleware. Run `npm run dev` for the integrated development server, or `npm run build && npm run start:monitor` for the built app and backend on loopback port 8787. Node 22.18+ is required for the backend's native TypeScript type stripping. This is a local single-operator tool; do not expose its unauthenticated metadata API to a shared network. Binding is loopback-only and monitor APIs reject foreign Host/Origin headers. Existing account-protected application routes retain their authentication requirements. This monitor does not activate chat, database storage, or generated briefs.

The frontend loads the local backend policy before importing application modules. It permits same-origin requests and the exact HTTPS origin configured by `VITE_SUPABASE_URL`. Fetch, XHR, WebSocket and EventSource hooks block destinations outside that policy. Fetch redirects are refused. A response CSP restricts browser connections and resource loading; nonces permit development bootstrap scripts without `unsafe-eval`. The policy governs this app's requests, not other applications or the operating system. Requests made before bootstrap, browser internals, worker traffic, asset byte counts, negotiated TLS parameters and WebSocket frame contents are not captured. A lost backend policy prevents new remote requests; it does not terminate connections already opened. Do not describe this as device-wide OSI enforcement. Layers 1–3 and the device firewall are not controlled or measured here.

The browser and local backend keep at most 5,000 metadata events each in memory; reload can restore backend-retained history. No event files are written. Clear removes backend and current-tab history; other open tabs may still hold their own in-memory events. Server restart drops backend history. Metadata collection retains hostname, a fixed route category, method, timestamp, status, duration, destination decision and coarse error class only. Unknown path segments are replaced in their entirety. Request/response bodies, cookies, authentication headers, full URLs and query strings are never collected or exported. The backend reconstructs a fixed event schema and drops all unrecognized fields, including client-supplied TLS assurance claims. Metadata is browser-reported, not an independently authenticated forensic record. Telemetry API requests are excluded from collection to avoid recursion.

TLS version, certificate pinning, key exchange, quantum-resistant identity, and application/update signatures are **Not verified** in this browser build. HTTP success and an HTTPS URL never produce a security-success assertion. The JSON export includes a SHA-256 of the exact UTF-8 `JSON.stringify(report, null, 2)` report payload; the hash detects changes relative to a trusted copy and is not a digital signature. Reports cover retained events, not necessarily a full day. No IP geolocation, reputation lookups, analytics, raw capture, or Python sidecar was added. No new runtime dependency was added; the local backend uses Node built-ins. The existing Eagle Eye profiling module remains disabled by default and separate from EAGLE VIEW.

Validation: `npm test`, `npm run test:monitor`, `npm run test:py`, `npm run test:e2e`, both TypeScript project checks, and `npm run build`. Browser smoke checks exercise mobile layout, live backend requests, pre-network destination blocking, seven layer rows, report hash, and clear. Electron packaging, desktop installers and signed desktop updates are excluded from the current release. Pinning, hardware posture and the application-layer PQ handshake remain unimplemented. These checks do not establish the original four-phase roadmap's acceptance criteria.

Read this before selling or deploying. It states what is protected, by what, and what is **not**.

## 1. Shape of the system

```
Desktop/Web client ──HTTPS──▶ Edge Functions (auth, chat, memory, …) ──service role──▶ Postgres
   x-sa-session token              authenticate every request                     private schema `core`
                                   derive user from the session only              reachable ONLY via sa_* RPCs
                                   seal/open sensitive fields (PQC vault)         legacy tables: RLS on, no policies
```

* **One deployment per customer** (their own Supabase project, keys, license). Never share a database between buyers.
* Browser roles `anon` and `authenticated` have **no table or function access**. Everything goes through Edge Functions.

## 2. What is implemented

| Area | Mechanism | Where |
|---|---|---|
| Accounts | License-gated registration; Argon2id (64 MiB, t=3, p=1) + optional server pepper; 12-char minimum; per-account lockout (5 failures → 15 min); same error for unknown user and wrong password; timing-equalised | `functions/auth`, `_shared/passwords.ts` |
| Sessions | 256-bit opaque tokens; only SHA-256 stored; 12 h absolute / 8 h idle; max 5 live per account; revoke on logout and on password change | `_shared/auth.ts`, `sa_session_*` |
| Licenses | Vendor-signed with **ML-DSA-65** (FIPS 204); verified offline; seat-counted atomically; revocable in DB | `_shared/license.ts`, `scripts/sa-keys.ts` |
| Stored content | **Hybrid X25519 + ML-KEM-768 (FIPS 203)** → AES-256-GCM envelopes bound to table/column/user | `_shared/pqc.ts`, `_shared/vault.ts` |
| Schema | Antique-numeral obfuscated identifiers in a private schema, accessed only by `SECURITY DEFINER` functions granted to `service_role`; owner-FK is `ON DELETE CASCADE` | `security/schema_obfuscation`, migration `…obfuscated_core.sql` |
| Legacy tables | All permissive policies dropped; RLS enabled; privileges revoked from `anon`/`authenticated` | migration `…lockdown_legacy.sql` |
| Audit | Append-only, hash-chained log; `select public.sa_audit_verify()` detects tampering | `sa_audit*` |
| Optional modules | Eagle Eye (person profiling) and the Home/PEMF bridge are **off** unless `ENABLE_EAGLE_EYE` / `ENABLE_HOME_NODE` = `true` | `_shared/gate.ts` |

Encrypted today: conversation messages (`belicia_memory.content`) and generated briefs (`scheduled_briefs.content`).
**Not** encrypted yet: profile fields, MiroFish/Policy Lab state, retrieval payloads (public corpus by design). Extend by calling `sealField/openField` at those read/write sites.

## 3. Limits you must not oversell

1. **Post-quantum scope.** The PQC here protects data at rest and license signatures. Transport security is whatever TLS your host terminates; ask your provider whether it negotiates hybrid `X25519MLKEM768`. Do not claim "quantum-proof".
2. **Not FIPS 140-validated.** The primitives are `@noble/*` (pure JavaScript). Some agencies require validated modules. The API in `pqc.ts` is small so OpenSSL 3.5+/liboqs can replace it.
3. **The AI provider sees plaintext prompts.** Messages are decrypted server-side to build the model request, then sent to Anthropic/Google/Lovable. Encryption at rest does not hide content from them. For sensitive customers use a zero-retention enterprise agreement or an on-prem/private model, and say so in the security questionnaire.
4. **The vault secret key lives in the function environment**, so a full compromise of the backend runtime can read stored content. Mitigations: restrict who can read secrets, rotate, keep an offline copy, monitor the audit chain. A true zero-knowledge mode (client-held keys) is incompatible with server-side AI calls.
5. **Obfuscation is not access control.** Anyone who can read the function source or database dump can map the symbols. It only slows casual inspection. The real barriers are §2's privileges, RLS and authentication. Roman-numeral glyphs also change under Unicode NFKC (`Ⅻ` → `XII`); the generator rejects any pair that would collide after normalisation, but never paste identifiers through tools that normalise.
6. **Lockout is a denial-of-service lever** against a known email. Add edge rate-limiting/WAF and consider alerting on repeated locks for high-profile accounts.
7. **Not built yet:** MFA / WebAuthn hardware keys, email verification, device binding, SBOM, SOC 2, an independent pen test. Buyers at this price point will ask for each. Desktop packaging is outside the current release scope.
8. **Eagle Eye** assembles dossiers on named individuals (account enumeration, breach lookups, photo GPS). It conflicts with the product's own charter and carries privacy/legal exposure for an official. It ships disabled; get counsel before enabling it for any customer.

## 4. Provisioning a customer (runbook)

```sh
# once, on YOUR machine (offline). Back the key up; never commit it.
node scripts/sa-keys.ts vendor-keygen --out vendor-license-signing.key

# per customer deployment (new Supabase project)
supabase link --project-ref <ref>
supabase db push                                       # applies migrations incl. obfuscated core + lockdown
node scripts/sa-keys.ts vault-keygen    # run the printed `supabase secrets set VAULT_*` lines
node scripts/sa-keys.ts secrets         # PASSWORD_PEPPER, CRON_SECRET
supabase secrets set VENDOR_LICENSE_PUBLIC_KEY=<printed by vendor-keygen> DEPLOYMENT_ID=<customer-slug>
supabase secrets set ANTHROPIC_API_KEY=… GEMINI_API_KEY=…          # as already used
supabase functions deploy                                          # all functions

# issue their license (lifetime = omit --expires)
node scripts/sa-keys.ts issue-license --key vendor-license-signing.key \
  --id SAS-2026-0001 --holder "Office of the Governor of …" --seats 5 --deployment <customer-slug>

# load the shared corpus (see §5)
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/import_civic_corpus.py corpus/*.jsonl --upload
```

Revoke a license: `update core."<licenses table symbol>" set "<revoked_at symbol>" = now() where …` (look the symbols up in `security/schema_obfuscation/profiles/stars_v1.json`). Schedule `select public.sa_purge_expired()` and `sa_audit_verify()` daily.

**Use a different random profile per customer.** Generate one, extend it for the template, render the migration, and commit that customer's profile to a private repo:

```sh
cd security
python3 -m schema_obfuscation generate --names auth_users,user_id --out profiles/customer_a.json   # random symbols
python3 -m schema_obfuscation extend  --profile profiles/customer_a.json --template schema_obfuscation/templates/core.sql.tmpl
python3 -m schema_obfuscation render  --profile profiles/customer_a.json --template schema_obfuscation/templates/core.sql.tmpl --out ../supabase/migrations/20261022000000_obfuscated_core.sql
```

## 5. Corpus (Constitution + history/values)

* Bundled: Constitution, Declaration, Bill of Rights, Amendments 11–27, two civil-rights statutes, Epictetus (`civic-passages.ts`).
* Books go to the database, not the bundle. Public-domain founding texts are preconfigured (`The Federalist Papers`, `Democracy in America`); run `python3 scripts/refresh_civic_corpus.py federalist tocqueville-1` on a machine with internet. The script verifies the downloaded title (Gutenberg IDs are easy to get wrong) and strips boilerplate.
* For a modern full-text U.S. history textbook, download one you are licensed to use (e.g. OpenStax *U.S. History*, CC BY 4.0, which requires attribution) and run `scripts/ingest_book.py`, then `import_civic_corpus.py --upload`. The `license` field is stored with every passage and returned with citations.
* Retrieval is full-text (Postgres `tsvector`), shared corpus plus the account's private records, and the model may cite only supplied passages.

## 6. Testing

```sh
npm test               # 31 TS tests: PQC, envelopes, signatures, licenses, Argon2id, sessions, vault, corpus, values charter
npm run test:py        # 14 tests: obfuscation library, NFKC collisions, migration/profile sync
npm run test:e2e       # real auth function in Deno + real Postgres: 24 checks (needs postgres, deno, node 22)
```

`security/tests/db_smoke.sql` exercises seats, lockout, sessions, record scoping, cascade-delete, the audit chain, and role privileges directly in SQL.
