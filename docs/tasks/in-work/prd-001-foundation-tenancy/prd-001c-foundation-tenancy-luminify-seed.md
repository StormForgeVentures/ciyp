# PRD-001c: Luminify Seed & Edge Shapes

> Parent: prd-001-foundation-tenancy-index.md | Module: Platform Foundation & Tenancy

## Goal

Implement the architecture §10 seed: a realistic Luminify default tenant (Tim's business — *"helping coaches become AI-enabled software companies"*) with real model routing, authored config, an embedded library corpus, demo members carrying deliberate edge shapes, and money-trail rows that materialize from real ledger entries. The seed is what makes "never ship mock" enforceable — empty DB = empty screens, so seed completeness is part of every downstream feature's definition of done. A separate minimal fixture tenant ships in the test suite (not the seed) to prove RLS isolation.

## Functional requirements

1. `pnpm seed` (idempotent, re-runnable) applies after migrations; runs in the same wave as 001b.
2. **1 tenant** (Luminify) + `app_config` with every slot key from ai-architecture §2 (`default`, `fast`, `classify`, `deep`, `worker`, `synthesis`, `vision`, `embed`, `rerank`, `stt`, `tts`) — real seed values, `tts.voice_id` carrying a real Fish-audio slot value.
3. **3–4 archetypes** + **2–3 tiers** as Luminify config rows — generic placeholder coaching content (e.g. operator/builder/connector), explicitly marked provisional (OQ-2: Tim authors final content at provision time). Each archetype carries a non-empty `prompt_fragment`.
4. **2 `coaching_process_definitions`** directives (a daily check-in method + a weekly review method), `source: 'code'`-shaped content stored as authored rows.
5. **Library corpus:** realistic Luminify body-of-work content — ≥ 8 documents, ≥ 200 chunks — chunked (canon defaults: ~500 chars, 20% overlap, title-prepended) and embedded with the real Voyage `embed` slot (`input_type: document`) at 1024-dim, with `tsvector` populated. Not 3 toy docs.
6. **3–5 demo members with edge shapes:** (a) brand-new — zero `member_facts`, empty L1; (b) mid-journey — rich `member_facts`, active cadence threads; (c) expired entitlement; (d) near-zero wallet-relevant usage (to exercise spend-auth denial paths); (e) long uploads / long-string fields.
7. **Wallet + ledger:** top-ups and metered debits as real `wallet_ledger` rows; `wallets.balance_credits` computed from the ledger (no magic numbers); `markup_rate` set to the provisional default (OQ-3, flagged).
8. **`ai_traces` + `usage_ledger`** rows consistent with the debits so metering/eval admin surfaces render on real data.
9. Seed content contains zero Kyle-specific identifiers (brief success criterion 6).
10. A `seed-verify` script (query suite) asserts every shape above; wired into CI after seed.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given an empty DB with migrations applied, when `pnpm seed` runs, then it exits 0; when it runs a second time, then row counts are unchanged (idempotent). |
| AC-2 | Given the seeded `app_config`, when the seed-verify suite runs, then every ai-architecture §2 slot key resolves to a `{provider, model}` (or `voice_id`) value. |
| AC-3 | Given the seeded library, then ≥ 200 `library_chunks` across ≥ 8 `library_items` carry a 1024-dim embedding and a non-null `tsvector`. |
| AC-4 | Given the demo members, then each edge shape verifies by query: the new member has zero `member_facts`; the mid-journey member has ≥ 10; the expired member's entitlement status = `expired`; the near-zero member's wallet-usage context matches its scenario. |
| AC-5 | Given the seeded wallet, then `wallets.balance_credits` equals `SUM(wallet_ledger.credits_delta)` for the tenant. |
| AC-6 | Given seeded `ai_traces` and `usage_ledger`, when the metering rollup query (tokens + cost by feature) runs, then it returns non-empty, internally consistent results (ledger cost ≤ traced cost × markup). |
| AC-7 | Given the seed SQL/scripts, when grepped for Kyle-era identifiers, then zero matches. |

## Data requirements

No new tables (consumes 001b schema). Seed data volume: small enough to apply in < 2 minutes locally, large enough that hybrid retrieval + rerank is meaningfully exercised (the ≥ 200-chunk floor).

## Endpoints

No new endpoints.

## UI/UX

No frontend changes in this slice.

## Hybrid Interface

Not applicable — Traditional lane (seed data).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Schema + RLS + enums | 001b | Required |
| Workspace tooling (`pnpm seed` entrypoint) | 001a | Required |
| Paid Voyage API key (real embeddings at seed time) | ADR-007 prerequisite | Required |
| Luminify body-of-work source content | Tim (provisioning input) | Required — interim: generic Luminify-voice coaching content authored for seed, replaced at provision |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | OQ-2 — final Luminify archetype/tier names + descriptions | Seed realism; prompt fragments feed the cascade | Deferred: generic placeholders now; Tim authors at provision time (architecture OQ-2). |
| Q-2 | OQ-3 — default credit↔cost markup value | Wallet math in seed must use some rate | **Decided (Tim, plan gate 2026-07-02): 1.1×** — seed and intake template use it as the per-tenant default. |
| Q-3 | Should seed embeddings be committed as fixtures to avoid Voyage calls on every reset? | CI cost + rate limits (ADR-007 lesson) | Interim: cache embeddings as checked-in fixtures keyed by content hash; re-embed only on content change. |
