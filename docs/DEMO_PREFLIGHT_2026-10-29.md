# Stars & Stripes — October 29 demonstration preflight

This is an operational checklist, **not** a certification of the hosted service. Source inspected on 2026-10-28. Do not distribute internal mappings, secrets, user records, or license-signing keys in buyer materials.

## Release status — conditional / not verified in hosted production
- Repository contains React/Vite/TypeScript, civic retrieval, Supabase Edge Functions, encrypted fields, license-backed session APIs, a private obfuscated Postgres schema template and access-control migration.
- `/eagle-view` is a *local Node browser-request metadata tool*; it is not OS-wide network capture or a Python-based firewall. It does not operate independently inside an Android WebView.
- Browser login and AI calls require **a separately provisioned Supabase project** with a real configuration. A preview without backend configuration renders research UI but cannot prove AI or persistence.
- The Android `supabase-launchpad` repository is a **separate TanStack Start/WebView wrapper**, not identical to this React/Vite repository. Compare deployed commit, routes and backend target before promising feature parity.

## Go/no-go gate
- [ ] Confirm the actual demo URL and APK both reference the intended Stars & Stripes deployment and not an older Belicia backend.
- [ ] Verify all intended migrations applied in order to the isolated project; inspect the actual `core` role grants and legacy RLS policies.
- [ ] Verify production env vars and function secrets are present *server-side* (never in APK, source or packet).
- [ ] Perform a new account activation with a properly signed test license; logout/relogin; ensure a revoked session is rejected.
- [ ] Confirm `auth`, `chat`, `memory`, `daily-brief`, `pod-room`, `game-theory`, and `mirofish` on the deployed functions, not only in source.
- [ ] Demonstrate a civic question with cited, accurately dated material; distinguish 2024 snapshot law from current law.
- [ ] Show profile or saved-conversation persistence across sessions *only if tested*.
- [ ] Test one successful simulation and one intentional, gracefully handled provider failure. Describe simulated agents as synthetic, not real voters.
- [ ] Confirm optional person-profiling and Home/PEMF paths remain disabled and inaccessible.
- [ ] Check 390px mobile presentation, scroll, touch navigation, microphone permissions if used, and offline/error UI.
- [ ] Run `npm ci && npm run build && npm test && npm run test:monitor && npm run test:py`; run DB-backed end-to-end checks in disposable infrastructure.
- [ ] Test authenticated and unauthenticated endpoint permissions; request an independent penetration test before sensitive production customers.

## Buyer-safe security wording
"Stars & Stripes uses application authentication, scoped server functions, restricted database access, content encryption for selected stored records, and schema obfuscation as a defense-in-depth inspection barrier. We are independently validating production controls before handling confidential government information."

Do **not** claim the obfuscated schema automatically blocks SQL injection or data poisoning. SQL injection mitigation requires typed/parameterized calls, reviewed dynamic SQL, least privileges and automated tests. Corpus poisoning requires provenance, source review and update controls. Cryptographic implementations are not equivalent to FIPS 140 validated modules, and server-side AI providers see plaintext prompts.

## Demonstration flow (6–8 minutes)
1. (30s) Public-purpose advisor and the nine civic objectives.
2. (90s) Ask a bounded policy question and verify passage citations; disclose snapshot age.
3. (90s) Run a synthetic policy/scenario thought experiment; explain uncertainty.
4. (60s) Show the research corpus and why it is not a complete legal database.
5. (60s) Explain customer-isolated backend and privilege boundaries without displaying secrets.
6. (60s) Show security metadata monitor and clearly state its browser-only limitations.
7. (60s) Close with the purchaser's acceptance criteria, private pilot scope, security due diligence and commercial process.

## Open blockers
Live migration status, hosted functions, entitlement activation, provider credentials, independent security audit, device parity, and production monitoring **cannot be established from source code alone**. Treat any unchecked item as pending, not passed.
