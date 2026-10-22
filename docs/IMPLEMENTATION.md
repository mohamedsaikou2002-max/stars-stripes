# Implementation and deployment notes

## Source and boundaries

Source: `mohamedsaikou2002-max/belicia`, upstream commit `c8928f5d4a4db5b04dc1c65a8332f288dd95ff31`. This adaptation is on `feature/stars-and-stripes`; do not merge over the personal app simply to deploy the new product. Create a separate repository/project for the new product when deploying.

The implementation preserves the React/Vite/TypeScript frontend, Three.js orb, Supabase storage, Edge Functions and existing integration interfaces. No existing deployment or data was modified. A new migration adds civic profile fields and a searchable corpus table without deleting original fields.

## Feature map

| Route or feature | Frontend | Backend / execution |
|---|---|---|
| Advisor and animated orb | `Index.tsx`, `CivicOrb.tsx` | `chat`, `memory`, `tts`; browser speech fallback |
| Civic source library | `Knowledge.tsx` | shared source catalog and snapshot coverage |
| Briefs | `Briefs.tsx` | `daily-brief`, scheduled_briefs; Python morning brief script |
| Policy Lab | `PodRoom.tsx`, `podApi.ts` | browser simulation plus `pod-room` AI helpers |
| Governance Swarm | `MiroFish.tsx` | `mirofish` state, round generation, scenario reports, agent interviews |
| Game theory | `GameTheoryRoom.tsx`, `gtApi.ts` | `game-theory` analysis, hypothetical narratives, simulation handoff |
| Intelligence compressor | `CivicIntelCompressor.tsx` | `intel-archive`, `intel-distill` |
| Eagle Eye | `EagleEye.tsx` | `eagle-eye` |
| Public-service profile | `Profile.tsx` | legacy profile table plus office_role, jurisdiction, office_location |
| Optional environment tools | `Home.tsx`, `usePemfState.ts` | `home-bridge`, `pemf-ingest`, Python home-node scripts |

The original MiroFish page was present but not routed in App.tsx. It is now available at `/swarm`; the existing Policy Lab remains at `/pod-room`.

## AI and retrieval

`_shared/civic.ts` defines the nine objectives and shared public-service principles. `chat/corpus.ts` retrieves relevant static passages and constructs the active prompt. All provider paths (native Gemini, gateway Gemini, Anthropic fallback) receive that prompt. Source grounding defaults on and can be disabled. Client-provided source passages are discarded server-side.

`_shared/civic-passages.ts` holds downloaded snapshots with URL, title, jurisdiction, category, retrieval timestamp and chunk ID. The new `search_civic_passages` RPC adds up to four matching imported passages. If the import migration is absent, static retrieval continues. Source dates are not assertions of current legal validity. The 2024 statutory snapshots must be checked for subsequent amendments before present-day application. Selected passages are exposed as links in each new chat response; the existing conversation history schema stores response text, not the separate source metadata array.

`civic-sources.ts` clearly separates snapshot texts from catalog-only directories. `docs/corpus-snapshots.json` records snapshot sizes and SHA-256 hashes. The federal courts, Supreme Court, Congress, US Code, eCFR, GAO, CBO and other directory links are research entry points, not claims that these entire collections have been ingested. Project Gutenberg source text retains its original license in the downloaded snapshot; see the original linked edition for distribution terms.

Refresh the explicitly selected foundational snapshots:

```sh
python scripts/refresh_civic_corpus.py
```

For reviewed federal/state/case-law material, prepare JSONL records:

```json
{"id":"unique-source-version-section-chunk","title":"Official source title and edition","url":"https://official-source.example/document","jurisdiction":"Maryland","category":"civil","retrieved_at":"2026-10-21T00:00:00Z","text":"Actual reviewed source text, no more than 10000 characters."}
```

`effective_date` is optional; use the document's actual date, not a guessed or retrieval date. The importer validates format; it does not certify legal accuracy, good-law status, or publisher authenticity. Review provenance before importing. Use jurisdiction `federal` for federal material or the exact state label selected in the advisor. Keep historical editions distinct in IDs/titles.

```sh
python scripts/import_civic_corpus.py reviewed.jsonl
# Only after configuring separate backend environment variables:
python scripts/import_civic_corpus.py reviewed.jsonl --upload
```

The upload command needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the process environment, not source files. It uses idempotent upserts in batches of 100. Full USLM/state/case-law ingestion and ongoing currency monitoring remain work to do; a short source catalog is not a full legal corpus.

## Backend setup

1. Create a separate Supabase project. Do not reuse the personal app's credentials or database.
2. Review and apply original migrations followed by `20261021090000_stars_stripes_civic_corpus.sql` to that new project. Existing `belicia_*` identifiers are intentionally preserved. New profile fields are additive.
3. Set frontend `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using `.env.local`.
4. Configure backend secrets required by enabled integrations: `GEMINI_API_KEY` (optional `GEMINI_MODEL`), or `LOVABLE_API_KEY`; optional `ANTHROPIC_API_KEY`/`DEFAULT_MODEL`; optional `ELEVENLABS_API_KEY` for the inherited TTS path. Supabase supplies its runtime URL and service-role key. Check each function for additional integration-specific secrets. Do not expose provider/service-role keys through VITE variables.
5. Deploy the Edge Functions from this checkout to the new project, including `pod-room`, `chat`, `memory`, and `mirofish`. Configure scheduling only if briefs are desired; no scheduler was installed by this change.
6. Smoke-test chat, retrieval, speech, saved sessions, profile updates, every simulation action and report in the separate project before any pilot.

## Swarm behavior and limits

MiroFish uses a generative model to create a scenario, then a small set of dialogue events per round. Recent agent memories are included in later prompts; stances and recent observations persist in state. This is in-context interaction, not independent models updating each other's weights. The browser Policy Lab uses its inherited numerical diffusion simulation and AI commentary. Neither is a calibrated model of a real electorate.

The adaptation adds U.S. governance scenarios and stakeholder roles, allows both positive and negative synthetic score deltas, removes automatic positive fallback progress, and asks reports to consider rights, costs, alternatives, dissent and validation. It does not convert these arbitrary indices to empirical probabilities. Round prompts include at most the first 100 personas for context-budget control even if a larger population is displayed; do not represent displayed agent counts as independent AI calls. The old model-generated 'real-time news' baseline is replaced with an explicit neutral assumption.

## Important inherited production gaps

The original app assumes a single `default` operator. Several legacy tables allow public access, Edge Functions disable gateway JWT verification, and service-role code trusts supplied user IDs. A new deployment must implement authenticated per-office membership and row-level isolation before handling private records or serving multiple offices. A private frontend URL alone does not secure public backend endpoints. No production-readiness claim is made here.

Other inherited limits: some optional integrations require actual hardware/external services; brief generation records delivery state without proving push delivery; the service worker is not a complete offline cache; large browser simulation/model requests need production load testing. The source library and prompts do not substitute for a licensed legal research service or Shepardizing/KeyCite-style case treatment.

## Verification

Production Vite build, TypeScript frontend check, and focused corpus retrieval tests are run for this adaptation. No live provider, database migration, hardware, voice device, scheduler, or multi-user access-control test was possible without a separate configured backend. Browser visual QA was unavailable in this environment. See the final handoff for test results.
