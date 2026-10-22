# Stars and Stripes

A public-leadership research and governance simulation adaptation of Belicia. Based on upstream commit `c8928f5d4a4db5b04dc1c65a8332f288dd95ff31`, preserved on a separate branch.

The original animated Three.js orb, voice input/output, conversations, memory, briefs, intelligence compressor, Eagle Eye, game theory, policy lab, profile, and optional environment integrations remain. The presentation uses a white background, dark readable text, red–white–blue linear gradients, and the original animated orb with patriotic colors.

Nine advisor objectives cover leadership and practical wisdom; the Constitution and civil liberties; civil justice; criminal law and due process; American history; public ethics; policy design; institutions and oversight; and deliberation. The active AI prompt and morning briefs use public-service principles rather than the former religious framing. Historical database names remain for schema compatibility, not product branding.

## Local setup

### Database-free traffic dashboard

The current beta is a browser app with a local Node backend. Electron packaging and desktop installers are excluded from this release.

With Node 22.18+ and dependencies installed, run `npm run dev` and open the `/eagle-view` route. EAGLE VIEW has its own local metadata backend and does not require Supabase login or database access. Use **Check backend request** and **Test destination blocking** to exercise the live feed. For a built local app, run `npm run build` followed by `npm run start:monitor` (loopback port 8787). Do not use `vite preview` for this workflow: it does not provide the monitor backend.

The dashboard enforces this app's allowed request destinations and reports unknown TLS/PQ facts honestly. It does not change system networking or enable the separate Eagle Eye module. See [security scope and limitations](docs/SECURITY.md). `npm run test:monitor` tests the metadata backend without a database.

Use Node 22+ and npm.

```sh
npm ci
cp .env.example .env.local
# Set the URL and publishable key for a NEW, separate Supabase project.
npm run dev
```

Without backend configuration the UI and knowledge library can be explored, but AI and saved work are unavailable. Do not point this copy at the personal Belicia database. The source contains no credentials. AI provider and service-role credentials belong only in the backend secret store.

```sh
npm run build
npm test
npx tsc --noEmit -p tsconfig.app.json
```

## Backend and research data

See [architecture and deployment notes](docs/IMPLEMENTATION.md) for the full feature map, new migration, required secrets, source refresh/import procedures, and inherited production limitations.

The initial corpus contains selected official constitutional documents, historical material, two **2024-edition** federal statutory sections, and a public-domain Stoic work. Source dates, URLs and chunk identifiers accompany retrieval. Other collections are labeled directories. This is **not a complete or automatically current corpus of U.S. law**. State law, case-law treatment, local rules, and most statutes require further ingestion and jurisdiction-specific review.

The swarm carries synthetic observations between rounds. It does not train AI weights, represent actual constituents, or produce validated forecasts. A neutral assumed baseline replaces the old unsupported claim of live world-news analysis.

This is a development adaptation, not a production deployment. The inherited single-operator storage model and permissive legacy policies require authentication, tenant isolation and access-control work before use by multiple offices or with confidential material. No original database was migrated and no live service was changed.

## Hardened build (accounts, encryption, obfuscated schema)

This copy adds license-gated accounts, session auth on every function, hybrid post-quantum field encryption, an obfuscated private schema, an American-values charter in the advisor prompt, and book ingestion for the retrieval corpus.

* Architecture, limits, and the customer provisioning runbook: [docs/SECURITY.md](docs/SECURITY.md)
* Obfuscation library (random profiles, NFKC-safe, SQL template renderer): [`security/schema_obfuscation`](security/schema_obfuscation)
* Keys and licenses: `node scripts/sa-keys.ts` (`vendor-keygen`, `issue-license`, `vault-keygen`, `secrets`)
* Corpus: `scripts/refresh_civic_corpus.py`, `scripts/ingest_book.py`, `scripts/import_civic_corpus.py`
* Optional modules (Eagle Eye, Home/PEMF bridge) are disabled unless explicitly enabled per deployment.
