# PRD-003b: Member Memory

> Parent: prd-003-coaching-surfaces-index.md | Module: Coaching Surfaces

## Goal

Give the coach-AI durable, member-controlled memory: an always-in-prompt L1 rolling summary, an L2
store of atomic embedded facts recalled per turn, and the working/session tiers that keep the turn
loop fast — with the member able to see, edit, and delete what the AI knows about them
(the anti-dependency principle carried from EL-OS). Hybrid (classification #9): the AI writes
memory, the member manages it on a screen.

## Functional requirements

1. **Three tiers, rule 8 boundaries:** working memory (turn-scoped) in Valkey with TTL ≤ 2h;
   session memory (durable transcript) in Postgres chat tables; long-term memory in `member_facts`
   (1024-dim embeddings, pgvector, tenant + member fenced) plus `member_recent_state` (L1).
2. **Post-turn extraction:** after each completed turn a memory pipeline (worker slot) extracts
   candidate facts, deduplicates against existing facts (similarity threshold), and writes new L2
   rows with deterministic ids; the L1 summary refreshes when the pipeline's curator deems the
   state changed (reason enum recorded).
3. **Recall:** each turn recalls top L2 facts via embedded query (member-fenced kNN + rerank) and
   injects L1 verbatim; recall results appear in the L4 context frame and are traced
   (`memory_recall`).
4. **Compaction (rule 9):** at 40 raw turns per session, a compaction job produces the structured
   session summary and prunes the raw window; guarded by a Valkey `SETNX` lock (`EX 600`) keyed by
   session id.
5. **Member control:** members list, edit, and delete their own L2 facts; edits re-embed the fact;
   deletes are soft (`deleted_at`) and excluded from recall immediately; member-edited rows are
   locked against AI overwrite.
6. **Cache discipline:** per-member recall cache (TTL 60s) invalidated on any member fact
   edit/delete and on pipeline writes.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seeded mid-journey member (rich L2), when the memory-continuity eval runs, then a recalled L2 fact and the L1 summary are both present in the turn grounding (score 1.0). |
| AC-2 | Given a member edits a fact via `PATCH /v1/me/memory/facts/:id`, when their next turn runs, then the grounding contains the edited content and not the prior content. |
| AC-3 | Given a member deletes a fact, then it no longer appears in `GET /v1/me/memory/facts` nor in any subsequent recall candidate set, and the row carries `deleted_at`. |
| AC-4 | Given a session at 40 turns, when two turn completions race, then exactly one compaction summary row exists for the session (lock verified by concurrent test). |
| AC-5 | Given the AI pipeline attempts to update a fact whose `source = 'member_edit'`, then the write is rejected and a new fact row is created instead. |
| AC-6 | Given a member of tenant A, when recall runs, then every candidate row carries that member's `member_id` and `tenant_id` (rule 4 payload-filter audit query returns zero violations). |
| AC-7 | Given working-memory keys for a session, then all carry TTL ≤ 2h (no unbounded Valkey keys — rule 8 audit). |

## Data requirements

- `member_facts` — see Hybrid Interface table (authoritative field list).
- `member_recent_state` — one row per member: `member_id` (pk), `tenant_id`, `content` (text),
  `reason` (enum, platform mechanic), `updated_at`. AI-written; member-readable.
- Session/chat tables from PRD-001; compaction summary lives on the session row (structured jsonb).
- Indexes: `member_facts (tenant_id, member_id, deleted_at)` btree + HNSW on `embedding`;
  filters touch indexed fields only (rule 5).

## Endpoints

- `GET /v1/me/memory` — member JWT; returns L1 content + paginated facts. P95 < 300ms.
- `PATCH /v1/me/memory/facts/:id` — member JWT; body `{content}`; re-embeds; sets
  `source = 'member_edit'`; invalidates recall cache. 404 across member boundary.
- `DELETE /v1/me/memory/facts/:id` — member JWT; soft delete; invalidates recall cache.

## UI/UX

Member "What your coach-AI remembers" screen (template renders; contract here):

```
┌──────────────────────────────────────────────┐
│ What your coach remembers                     │
│ ┌──────────────────────────────────────────┐ │
│ │ Current picture (L1 summary — read-only) │ │
│ └──────────────────────────────────────────┘ │
│ Facts                                         │
│ │ "Training for a May marathon"   [Edit][x] │ │
│ │ "Prefers morning check-ins"     [Edit][x] │ │
│ │ ...                                        │ │
└──────────────────────────────────────────────┘
```

Key behaviors: edit is inline with optimistic update + rollback on 4xx; deletes confirm once;
list paginates at 50; empty state explains how memory forms (new-member seed exercises it).

## Hybrid Interface

**AI side owner:** ai-infra (ai-memory-design) · **SaaS side owner:** saas-build (member memory API + screen contract)

### Shared data shape

- **Table:** `member_facts`
- **Schema:**
  - `id` (uuid, pk) — written by [AI, UI] — read by [both] — AI rows deterministic from `(thread_id, turn_id, fact_index)`
  - `tenant_id` (uuid, indexed) — written by [both] — read by [both] — RLS fence
  - `member_id` (uuid, indexed) — written by [both] — read by [both] — RLS fence
  - `content` (text, ≤ 500 chars) — written by [both] — read by [both]
  - `tier` (enum, platform mechanic) — written by [AI] — read by [AI]
  - `source` (enum: `ai_extraction | member_edit | doc_distillation`) — written by [both] — read by [both] — `member_edit` locks row from AI updates
  - `embedding` (vector 1024) — written by [system on any content write] — read by [AI]
  - `salience` (numeric, decayed) — written by [AI] — read by [AI]
  - `ai_trace_id` (uuid, nullable) — written by [AI only] — read by [UI debug/admin]
  - `created_at` / `updated_at` / `deleted_at` (timestamptz) — written by [both] — read by [both] — soft delete
- **Migration owner:** saas-build (PRD-001 schema wave)
- **Versioning policy:** schema change = migration; extraction-prompt changes = `PromptVersion` record (the extractor is a versioned prompt).

### Write contract (AI → SaaS)

- Writers: post-turn extraction pipeline; `doc_distillation` ingestion path. No model-invoked
  free-form write tool in v1.
- Validation: non-empty `content` ≤ 500 chars; valid tier; dedup against similar facts (cosine ≥
  0.92 → skip); member-edit lock honored.
- Idempotency: deterministic id; `ON CONFLICT DO NOTHING`.
- Failure mode: extraction failure is traced and dropped — never blocks or degrades the member's turn.

### Read contract (SaaS → AI)

- UI surfaces: member memory screen (`/me/memory` in template); admin debug view (trace-linked, role-gated).
- Query patterns: paginated list by `(tenant_id, member_id, deleted_at is null, created_at desc)`;
  recall kNN with the same fence.
- Latency: member list P95 < 300ms; recall leg (kNN + rerank) P95 < 150ms.
- Caching: per-member recall cache TTL 60s; invalidated on any fact write/edit/delete.
- Permission model: RLS tenant fence + member fence; members CRUD only their own rows; coach/admin
  read is role-gated and read-only; superadmin debug reads trace-scoped.

### Cross-side consistency

- **PromptVersion trigger:** extractor/curator prompt change; L1-curation prompt change.
- **Re-index trigger:** member `content` edit → synchronous re-embed of that row (single-row, not a batch job).
- **Conflict resolution:** member wins — `source='member_edit'` rows are immutable to the AI; AI adds new facts instead.
- **Audit trail:** `source` + `ai_trace_id` on every AI-written row distinguishes emission from manual edit.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `member_facts` / `member_recent_state` tables + seed edge shapes | PRD-001 | Required |
| Embedder/reranker ports, `embed` slot (input-type discipline) | PRD-002 | Required |
| Valkey (working memory + locks) | PRD-002 infra | Required |
| Doc-distillation source path | PRD-005 | Modified here (writes `source='doc_distillation'`) |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Does the coach see member facts by default, or opt-in per tenant? | Privacy posture vs coaching value | Interim: role-gated read-only ON per tenant config default; revisit with first real coach. |
| Q-2 | Fact decay half-life default? | Recall quality vs staleness | Interim: port EL-OS decay params unchanged; tune via continuity eval. |
