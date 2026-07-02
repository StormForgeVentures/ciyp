# Feature Classification — ciyp-platform (Coach in Your Pocket)

**Generated:** 2026-07-02 (ai-design phase)
**Discovery source:** `docs/project-brief.md` + Tim's 2026-07-01 scope additions (`handoff/sport-sdk-orientation.md` §5)
**Version:** v1 (re-run on scope change)
**Rubric:** `.claude/references/ai/feature-classification.md` · Rules: `.claude/references/ai/ten-enforcement-rules.md`

> Scope note: this classifies the **platform's** features, including engine-executed member features whose
> UI renders in `ciyp-template`. The template repo inherits these classifications; it does not re-classify.
> Runtime substrate for every AI-native/Hybrid feature is the Sport AI SDK (ADR-006).

## Summary

- Total features in scope: **18**
- AI-native: **2**
- Traditional SaaS: **7**
- Hybrid: **9**

## Feature classifications

### 1. Text coaching chat (member ↔ coach-AI)
- **Lane:** AI-native (with inline components)
- **Rationale:** Example 4.1 verbatim — primary surface is conversation; output generated per turn; success judged by conversation quality (§3 AI-native criteria 1, 2, 4). The `parts` discriminated union (`text | audio | library_citation | process_offer | voice_input_ref`, architecture §4.5) makes citations and process offers **inline chat artifacts** per §2.1a — display-only (`library_citation`) and interactive (`process_offer` emits an accept/decline return event).
- **Build path:** `ai-feature-design` (cascade + routing + RAG recall + memory), component specs for the `parts` renderers (loading/partial/error states mandatory), `chat-artifact-registry.md` manifest. No standalone PRD/screens.
- **Eval signal:** routing accuracy ≥ 0.9 (alert 0.85) · retrieval precision ≥ 0.7 (alert 0.4) · faithfulness/groundedness judge ≥ 0.95 (alert 0.8) · agreement-rate (anti-sycophancy) tracked. Ports EL-OS golden sets.

### 2. Voice coaching session
- **Lane:** AI-native
- **Rationale:** Same conversational surface as #1 over a different modality; no standalone screen; success = conversation quality + latency. Server-side execution (Pipecat → API turn → TTS), the P0 differentiator.
- **Build path:** `ai-feature-design` for the voice turn path; spend-authorization hard-check integration (contract 04) at session start + interval re-check.
- **Eval signal:** same conversation-quality metrics as #1, plus STT word-error tolerance on golden clips, turn-latency P95 budget, and **spend-checkpoint correctness** (session refuses on empty wallet; cuts at checkpoint when drained) as a deterministic eval.

### 3. Daily check-in + cadence (weekly checkpoint, monthly review)
- **Lane:** Hybrid
- **Rationale:** §3 Hybrid criteria 1–2: the conversation (bounded cadence threads with forced finalize) produces structured records (check-in responses, status/self-trust-index) that members revisit and coaches view — the §4 edge-case rule: "persisted as a viewable record → Hybrid."
- **Build path:** AI side via `ai-feature-design` (cadence directives, finalize discipline); SaaS side PRD for check-in/cadence history surfaces.
- **Interface notes (hybrid-interface-contract.md):** cadence-output/check-in table schemas are the contract — written by cadence tool calls, read by member history UI (template) and coach admin.
- **Eval signal:** interaction-mode correctness ≥ 0.9 (alert 0.8, ports EL-OS eval) · finalize-rate on bounded threads = 1.0 · faithfulness of generated summaries.

### 4. Guided coaching processes (directive-driven methods → member-approved docs)
- **Lane:** Hybrid
- **Rationale:** Conversation executes the process, but the goal is a persistent artifact (`doc-approved` outputs, e.g. plan documents) members view later and admins audit — two surfaces, shared `coaching_process_outputs` shape (§3 Hybrid 1, 2, 4).
- **Build path:** AI side: process-runner port + directive execution (Sport Process registration, eval-gated); SaaS side: outputs/history surfaces PRD.
- **Interface notes:** `coaching_process_definitions` (read at runtime) and `coaching_process_outputs` (written by runs) are the contract tables; doc approval state machine is platform enum.
- **Eval signal:** plan-document fidelity = 1.0 (deterministic, ports EL-OS) · goal-gate correctness · per-process directive-faithfulness judge.

### 5. Coach-authored agent studio (roles, process directives, prompts, tool allowlists, MCP integrations)
- **Lane:** Hybrid
- **Rationale:** Example 4.8 (coach persona editor) generalized — a screen-based authoring UI writes config the AI reads at runtime; removing either surface guts the product ("the most important thing," Tim 2026-07-01). §3 Hybrid criteria 3, 4, 5.
- **Build path:** SaaS side: authoring UI PRD (roles/processes/prompt blocks/tool picks/MCP integration enable-disable + versioning UX). AI side: config-store hydration into Sport `defineRole`/`defineProcess`/cascade blocks; per-scope assembly rebuild on save. **Depends on SDK issues #25–#27 resolved** (per-scope assembly manager, registry upsert, config-store ports) — no SDK version pin.
- **Interface notes:** per-tenant definition tables (roles, process directives, cascade blocks, `tenant_integrations`) are the contract; every activation bumps prompt-set version → `prompt_versions` + `eval_snapshots`; `aiFixHint` validation errors surface in the authoring UI for self-correction.
- **Eval signal:** **no-eval-no-ship is structural** (Sport refuses eval-less processes): every authored agent/process passes the standard eval pack (SDK #30 or platform-side equivalent) before activation; config-change → eval-snapshot linkage rate = 1.0.

### 6. Instance identity & platform config authoring (archetypes, tiers, journeys, branding, model routing, voice persona)
- **Lane:** Hybrid
- **Rationale:** Example 4.8 again — admin UI writes `tenant_archetypes`/`tenant_tiers`/`app_config` (incl. model slots + `tts.voice_id`); the runtime reads them on every turn (ADR-002). Distinct from #5: this is the de-enum platform config surface, not agent authoring.
- **Build path:** SaaS side: config authoring UI PRD; AI side: cascade injection of archetype `prompt_fragment`s, per-scope slot resolution.
- **Interface notes:** ADR-002 tables + Instance Config contract (contract 01) to the member UI; config edits version and eval-gate per ADR-002 constraint.
- **Eval signal:** config-edit → prompt-set-version bump = 1.0 · post-edit golden-set pass before go-live · slot-invalidation latency (edit visible without redeploy).

### 7. Library ingestion + management (body of work → chunk → embed)
- **Lane:** Hybrid
- **Rationale:** Example 4.3 verbatim (knowledge ingestion flow).
- **Build path:** AI side: chunking (canon default: recursive ~500 chars / 20% overlap), asymmetric embedding, two-stage retrieval, delete-then-re-index discipline; SaaS side: upload/status/list/delete UI PRD (ports EL-OS pipeline: PDF, Cloudflare Stream media → Deepgram, Vimeo).
- **Interface notes:** library-document table (metadata + pipeline status) is the shared shape; UI writes `pending`, worker advances stages, UI polls.
- **Eval signal:** retrieval precision ≥ 0.7 (alert 0.4) on the tenant's golden corpus · ingestion-stage completion rate · zero cross-tenant recall (rule 4 audit, deterministic).

### 8. Meeting-transcript import — Granola / Fathom connectors
- **Lane:** Hybrid
- **Rationale:** Ingestion variant of 4.3 with a connector-management surface: coach connects an account (OAuth/MCP), recordings flow into the same ingestion pipeline; UI manages connection state + imported items. **Net-new** — no EL-OS precedent (orientation §3); ScalingCFO's QBO connector is the pattern (SDK issue #29).
- **Build path:** connector layer (per-tenant MCP catalog + OAuth token vault), then reuse #7's pipeline; SaaS side: integrations UI PRD.
- **Interface notes:** `tenant_integrations` + imported-item provenance on library documents (source = granola|fathom|upload|vimeo).
- **Eval signal:** import fidelity (transcript content reaches indexed chunks, deterministic) · retrieval precision including imported corpus · connector health (token-refresh success rate).
- **Priority:** **P0** (Tim, 2026-07-02 — supersedes the brief's P1 "MCP transcript ingestion").

### 9. Member memory (L1 rolling state + L2 member-facing editable facts)
- **Lane:** Hybrid
- **Rationale:** AI writes/recalls memory in conversation; members **view and edit their own facts** (EL-OS anti-dependency principle) — two surfaces over `member_facts`/`member_recent_state` (§3 Hybrid 2, 4).
- **Build path:** AI side: three-tier memory per rule 8 (working = Valkey TTL; session = transcript tables; long-term = tenant-fenced pgvector facts), 40-turn compaction with lock (rule 9); SaaS side: "what the AI knows about me" view/edit surface (template renders it).
- **Interface notes:** `member_facts` schema (tier, source, decay, embedding) is the contract; member edits invalidate recall caches.
- **Eval signal:** memory-continuity = 1.0 (recalled L2 fact + L1 reach grounding — ports EL-OS's "cutover blind spot" eval) · recall non-regression = 1.0.

### 10. Coach ↔ client messaging with AI-surfaced context
- **Lane:** Hybrid
- **Rationale:** Human-to-human messaging screen (Traditional shape) plus an AI surface that makes it valuable: the coach sees AI-surfaced client context (memory, journey position, recent check-ins) beside the thread — "chat with their clients and truly understand them" (Tim). Removing the AI context panel guts the differentiator; removing the screen removes the feature (§3 Hybrid 1, 4).
- **Build path:** SaaS side: messaging PRD (ports EL-OS Coach Messaging domain); AI side: context-surfacing tool spec (read-only recall over member memory + program config).
- **Interface notes:** the context panel reads the same memory/cadence shapes as #3/#9 — read-only; message data itself is never AI-generated in v1.
- **Eval signal:** faithfulness of surfaced context (judge; no fabricated client facts) ≥ 0.95 · recall precision on the context panel.

### 11. Multi-tenant admin (coach auth, tenant management, superadmin)
- **Lane:** Traditional SaaS
- **Rationale:** §3 Traditional 1–4; §6 "admin features classify by their own surface." No generation in the loop.
- **Build path:** full PRD → design → build; standard QA + security (tenant isolation).

### 12. AI wallet (credits, top-ups, Stripe recharge, ledger, enforcement policy)
- **Lane:** Traditional SaaS
- **Rationale:** Example 4.4 family — ledgers, Stripe flows, balance screens; data integrity over conversation quality. It *gates* AI spend via the spend-authorization contract, but contains no generation (§6: reading/limiting AI usage ≠ Hybrid).
- **Build path:** full PRD (ADR-003 mechanics); append-only ledger discipline; standard QA + security. Deterministic integration tests for enforcement (empty wallet pauses voice/transcription; top-up restores) — required, but they're correctness tests, not eval signals.

### 13. Usage metering aggregation + rollup (`ai_traces` → usage events → ledgers)
- **Lane:** Traditional SaaS
- **Rationale:** Data pipeline + billing integrity; at-least-once idempotent plumbing (contract 03). No generation.
- **Build path:** PRD with reconciliation invariants (ledger = truth; cache advisory); property/idempotency tests.

### 14. Program-access store (Stripe web checkout → entitlement)
- **Lane:** Traditional SaaS
- **Rationale:** Example 4.4 verbatim.
- **Build path:** full PRD; webhook idempotency; entitlement contract (05) to the member UI.

### 15. Instance provisioning (runbook + script)
- **Lane:** Traditional SaaS
- **Rationale:** Operational flow with defined inputs/outputs (§3 Traditional 1, 4). Step 5 of the runbook invokes the eval harness ("no eval, no ship" before go-live) — it consumes AI infrastructure, it isn't AI.
- **Build path:** PRD for the script + intake; provisioning dry-run test on the Luminify seed.

### 16. Prompt management / versioning UI (P1)
- **Lane:** Hybrid
- **Rationale:** Example 4.8 pattern — UI manages `prompt_versions` (+ linked `eval_snapshots`) the runtime reads; rollback is a product action with AI consequences.
- **Interface notes:** `prompt_versions` (synchronous write, rationale required — EL-OS discipline) + eval-snapshot linkage.
- **Eval signal:** every prompt change linked to an eval snapshot = 1.0; rollback restores prior eval-passing state.

### 17. Usage analytics dashboards (P1)
- **Lane:** Traditional SaaS
- **Rationale:** Screens over `usage_ledger`/`ai_traces` rollups; §6 "admin observes AI data" ≠ Hybrid.

### 18. Admin team roles (P1)
- **Lane:** Traditional SaaS
- **Rationale:** RBAC CRUD; platform-mechanic enums (ADR-002).

## Cross-feature notes

**Shared data shapes:** per-tenant `app_config` (model slots, voice persona) · `tenant_archetypes`/`tenant_tiers` · `coaching_process_definitions` + agent/role/cascade-block definition rows (#5, #6) · library documents + chunks (#1, #7, #8) · `member_facts`/`member_recent_state` (#1, #2, #3, #9, #10) · `ai_traces` + `usage_ledger` (#12, #13, #17) · `prompt_versions`/`eval_snapshots` (#5, #6, #16) · `tenant_integrations` (#8) · the `parts` union (frozen wire/storage/render shape, contract 02).

**Shared AI infrastructure (not lane-classified — substrate):**
- **Sport AI SDK runtime** (ADR-006): per-scope assembly, slot resolution, tracing, memory/RAG ports, governance. All AI-native/Hybrid features run through it.
- **AI engine port** (`packages/agents` + `packages/prompts` from EL-OS): classifier, linter chain, interaction engine, cadence agents, process runner — pure, substrate-injected.
- **Eval harness + observability**: ports EL-OS `src/evals` (judge, golden sets, runner) + `ai_traces` extended with token/cost columns (metering substrate). Its admin review surface is a Traditional screen inside #11/#16.
- **Vector store**: Supabase pgvector, tenant-fenced (rules 4–6 bind every collection); hybrid BM25+dense via RRF k=60 + cross-encoder rerank.

**Enforcement:** the ten rules bind every downstream AI task; rules 1–3 and 6 are structurally enforced by the Sport runtime (trace-on-every-call, `HardcodedModelError`, two-stage memory box) — audits verify wiring, not reinvention.

## Re-classification triggers

- Member web surface decision (does a member web area live in `apps/web`?) — affects surface ownership, not lanes, but re-check #3/#9 surfaces when decided.
- Granola/Fathom P0/P1 call (feature #8).
- A cadence/check-in "history" surface getting cut → #3 could collapse to AI-native.
- Eval results contradicting a lane (rubric §5 standing triggers).
