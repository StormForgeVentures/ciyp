# QA — PRD-002 Sport Runtime — Wave 2 (§2.0–4.0)

**Reviewer:** qa-reviewer (independent, evidence-based) · **Date:** 2026-07-02
**Scope:** integrated `main` (post PM reconciliation, HEAD 288f91c). Sport assembly + ports + live slots + eval harness.
**Verdict:** MERGE-QUALITY for the runtime substrate (assembly/ports/slots/turn/traces are real and tested) — but the **eval layer (§4.0) is materially incomplete**; module AC-4 is PARTIAL, not met. Needs-fixes on §4.2 before "full eval suite green" can be claimed.

## Re-run evidence (my machine, not the dev's/PM's numbers)

- `pnpm typecheck` → exit 0. `pnpm build` → exit 0. `pnpm test` → exit 0, **9/9 turbo tasks**; `@ciyp/agents` **176**, `@ciyp/db` isolation **11**, `@ciyp/api` **113**.
- `supabase db reset && pnpm seed && pnpm seed:verify` → all green: 1 tenant, 227 library_chunks, HNSW reachable, wallet/markup invariants, no donor-IP.
- `pnpm evals` (keyless — VOYAGE present, no OPENROUTER) → **exit 0**; 2 metrics `ok`, 6 `skipped`.
- Cross-track coherence: after the full suite (all 3 tracks create+teardown fixtures), re-ran `seed:verify` → still passes "exactly 1 tenant" invariant. **Teardown is coherent.**

## Findings

### Must-fix — none that block the runtime substrate; see the Major completeness gap below.

### Major

- **§4.2 — the eval suite is 2/8 real; "full eval suite green on seed" (module AC-4 / AC-002-…-04) is NOT met.**
  `apps/api/src/evals/registry.ts`: the `keyGated()` factory returns `null` **unconditionally** (line 92), even when the required key is present — these are placeholders, not key-gated real evals. Six of eight metrics (`routing_accuracy`, `retrieval_precision_library`, `agreement_rate`, `interaction_mode_correctness`, `member_memory_continuity`, `faithfulness`) produce no value. Only `cascade_determinism` and `plan_document_fidelity` (deterministic, key-free) measure anything.
  - **Repro/evidence:** `pnpm evals` output shows `retrieval_precision_library … skipped` **without** the `(missing_key)` tag the model-keyed metrics carry — the Voyage embed key IS present and live, the runner called `run()`, and the stub returned `null`. So retrieval precision is unmeasured despite having everything it needs.
  - **Missing artifacts:** no `apps/api/src/evals/judge.ts` (FR-1 requires an LLM-as-judge on `fast`/`deep` slots); no `evals/golden/` fixtures directory (FR-1/FR-2 require golden sets). This is the EL-OS harness port that was deferred.
  - **Consequence for AC-002-…-32 (002d AC-2, "keys present → every metric row carries value/target/alert"):** the current implementation **cannot** satisfy it — judged metrics persist a null score even with keys. `test/evals/harness.live.test.ts` AC-2 only asserts `cascade_determinism`, so it passes without proving the AC as written (silent-pass).
  - **Disclosure:** honestly flagged in tasks-002 §4.2 NOTE. But the "no eval, no ship" safety net is currently ceremony for 6/8 metrics — a green `pnpm evals` overstates AI-quality coverage on the seed.

### Should-fix

- **Trace-coverage AC-7 (AC-002-…-37) is partial.** FR-8 taxonomy = classify, model_call, retrieval, rerank, memory_recall, linter_intervention, tool_dispatch (7). `test/sport/internal-turn.live.test.ts` asserts **only 4** (spend_authorization, retrieval, classify, model_call) and its own comment admits rerank/memory/linter "fire only under … richer golden turns" — **those golden turns don't exist**. "Every decision type has ≥1 row" is not demonstrated.

### Note

- **AC-33 (model_call tokens non-null)** is verified against a **mock caller's fabricated** token counts, not a real provider response (no OPENROUTER key). The wiring populates the columns; real-provider usage capture is unverified — re-check on the key-present pass.
- **AC-38 (ai_traces/eval_snapshots admin-only)** is covered **structurally** by `packages/db/test/isolation.test.ts` (accepts ai_traces admin-SELECT + eval_snapshots admin-ALL policy shapes), not by a behavioral "non-admin authenticated role gets zero rows" assertion. Weaker than the AC wording but reasonable.
- Internal turn (§2.5) **genuinely runs end-to-end** on the live seed: scope→GUC→host→slot→spend→**real-DB retrieve**→cascade→brain→traces under one correlation id (embed is a fixture vector = zero Voyage spend, but the vector-store query hits real seed chunks). Trace rows are real. The "every decision traced" phrasing is overstated (only the 4 types this path exercises) — see AC-7 above.

## VERIFIED-eligible ledger rows (002)

- **AC-002-…-15..-22** (002b assembly / scope-resolver / no-jwt lint / embedder input-type / spend deny / vector cross-tenant-zero) — passing live tests; scope-resolver + tenant-context read in depth (GUC fence from verified session only, member-never-coach invariant present).
- **AC-002-…-23..-30** (002c live slots / Rule-2 guards / cascade lock+determinism+trim / prompt-version-on-write) — passing tests; trace-and-prompt.live read in depth (rationale-required + prompt-set bump confirmed).
- **AC-002-…-31** (keyless evals exit 0), **-33** (model_call tokens — *mock caveat*), **-34** (rationale rejection), **-35** (smoke loud-fail names slot+slug), **-36** (429→blocked).
- **AC-002-…-38** (RLS admin-only — *structural caveat*).

**WITHHOLD (do not mark VERIFIED):**
- **AC-002-…-32** — unmeasurable with the current stub registry (judged metrics null even with keys).
- **AC-002-…-37** — taxonomy coverage partial (4 of 7 decision types).
- **Module AC-4 (index AC-002-…-04)** — mark **PARTIAL**: eval suite is 2/8 real.
