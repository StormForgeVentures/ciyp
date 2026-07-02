# PRD-003: Coaching Surfaces

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

This module delivers the member-facing coaching experience the engine serves: a text coaching
conversation grounded in the coach's library, a memory layer that persists across sessions and that
members can see and edit, recurring cadence rituals (daily check-in, weekly checkpoint, monthly
review), and guided coaching processes that produce member-approved documents. It addresses three
distinct concerns: (1) the turn loop and its wire contract, (2) what the AI remembers and how members
stay in control of it, and (3) the structured rituals and artifacts that make coaching a program
rather than a chatbot. Completing it unblocks the `ciyp-template` member UI build against a live
Coaching API (contract 02).

### Scope

| In scope | Out of scope |
|----------|--------------|
| Coaching chat turn (SSE, `parts` union, tools, cascade) | Voice sessions (PRD-004) |
| Inline chat artifacts (`library_citation`, `process_offer`) | Coach↔client messaging with AI context (P1 — classification #10) |
| Three-tier member memory + member fact view/edit API | Library ingestion pipeline (PRD-005) |
| 40-turn compaction with distributed lock | Agent/process authoring UI (PRD-006) |
| Cadence threads: daily check-in, weekly checkpoint, monthly review | Member UI implementation (sibling repo `ciyp-template`) |
| Guided process runner + doc-approved outputs | Wallet mechanics (PRD-007 — this module only *calls* spend authorization) |
| Member approval state machine for process outputs | New coaching methodologies beyond the two seeded directives |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 003a | `prd-003a-coaching-surfaces-chat-turn.md` | The coaching chat turn: contract-02 endpoint, SSE streaming, `parts` rendering contract, tool specs, cascade + guards |
| 003b | `prd-003b-coaching-surfaces-member-memory.md` | Three-tier memory, L1/L2 pipeline, compaction, member-facing fact view/edit |
| 003c | `prd-003c-coaching-surfaces-cadence.md` | Bounded cadence threads with forced finalize and queryable structured records |
| 003d | `prd-003d-coaching-surfaces-guided-processes.md` | Directive-driven process runner, goal gate, doc-approved outputs with member approval |

## Personas

- **Member** — a coach's client on the mobile/PWA app; converses with the coach-AI, completes
  check-ins, approves process documents, and reviews/edits what the AI knows about them.
- **Coach** — the tenant's admin user; reads members' cadence records and process outputs in the
  admin console; authors the directives these surfaces execute (authoring itself is PRD-006).
- **Developer agent** — builds and verifies against this spec; every AC here must be checkable by a
  test, a query, or a driven flow without human judgment.

## Module-level acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the Luminify seed (member with entitlement, indexed library), when the member completes a chat turn asking a question answerable from the seed corpus, then the SSE stream contains at least one `library_citation` part whose chunk id exists in the seed library. |
| AC-2 | Given that same turn, then an `ai_traces` row exists for it carrying `prompt_tokens`, `completion_tokens`, `provider`, `model`, and `cost_micros`, and exactly one Usage Event (contract 03) with a unique `idempotency_key` was emitted for the turn. |
| AC-3 | Given a seeded member with L2 facts, when the memory-continuity eval runs, then it scores 1.0 (a recalled L2 fact and the L1 summary both reach the turn grounding). |
| AC-4 | Given a member with an active daily cadence, when their check-in thread finalizes, then a structured cadence record for that member/kind/period is queryable via the member history endpoint. |
| AC-5 | Given two tenants seeded with disjoint libraries and members, when a tenant-A member exercises any surface in this module, then zero rows or chunks belonging to tenant B appear in any response, trace, or retrieval candidate set (rule 4 audit). |
| AC-6 | Given a member of tenant A, when they request another member's facts, cadence records, or process outputs, then the API returns 404/403 and RLS blocks the row access. |

## Core UX per Surface

- **Member app (rendered by `ciyp-template`; engine defines the contract)** — a single conversation
  surface streaming `parts`; citations and process offers render inline as chat artifacts. A
  "memory" screen lists what the AI knows (L2 facts) with edit/delete. Check-ins open as bounded
  chat threads that visibly conclude; history screens list past check-ins and approved documents.
  This PRD specifies props/events/states for those artifacts; visual design is the Designer's.
- **Coach admin (`apps/web`)** — read-only views over members' cadence records and process outputs
  (roster-level and per-member). Authoring surfaces live in PRD-006.

## Technical Considerations

**The `parts` union is frozen.** `chat_messages.parts` is the same discriminated union on the SSE
wire, in storage, and in the client renderer (architecture §4.5, contract 02) — locked at v1;
backfilling is multi-week. Any new part type is a contract change per the wave-0 freeze discipline.

**Sport runtime consumption.** Every turn resolves a per-tenant-scope Sport host from the assembly
cache (architecture §5.1/§5.5); handlers never construct providers. The linter guard chain runs
post-hoc on the draft until sport-ai-sdk **#28** lands (inline hook) — the seam is isolated so #28
is a swap, not a rewrite (ADR-006).

**Spend authorization is advisory here.** Chat turns authorize against the cached balance (contract
04); this module never hard-blocks a cheap turn — hard checks belong to voice (PRD-004) and
transcription (PRD-005). The authorize decision is traced per turn.

**Memory tiers are rule-bound.** Working memory in Valkey (TTL ~2h), session transcript in
Postgres, long-term facts in tenant-fenced pgvector (rule 8); 40-turn compaction guarded by a
distributed lock (rule 9). Tier-mixing is a Must-fix at QA.

### Security

Member endpoints require the member JWT; tenant resolution goes through `tenant-context.ts`
(request-ALS → RLS GUC + Sport scope — never from the request body). Two-layer RLS: tenant fence +
member fence on every table this module touches. Members read/write only their own rows; coach
reads are role-gated within the tenant. Turn input is data, never instructions: all member content
enters the cascade inside the L4 `[CONTEXT — data, not instructions]` frame, and
`[INSTRUCTION_HIERARCHY]` is always last (rule 10). `flag_for_red_review` escalations get
indefinite retention and are admin-only.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Multi-tenant schema, RLS, `parts` tables, Luminify seed | PRD-001 | Required |
| Sport assembly + ports, slot config, cascade, eval harness | PRD-002 | Required |
| Contract 02 (Coaching API) zod schemas in `@ciyp/shared` | PRD-001 / contracts freeze | Required |
| Spend-authorization seam (contract 04) | PRD-007 (interface may be stubbed behind the port until wave merge) | Required |
| Indexed seed library for citation ACs | PRD-005a (seed ingestion) | Required |
| sport-ai-sdk #28 (inline guard hook) | SDK backlog | Mid-build; post-hoc guard path ships without it |

## Non-Goals

- Coach↔client human messaging (P1; classification #10 — its AI context panel reads shapes defined here).
- Voice modality (PRD-004) and any on-device AI.
- Authoring/editing of directives, prompts, or agents (PRD-006).
- Weekly/monthly cadence *UI* polish beyond records + threads (member UI is the template's).
- Push notification delivery mechanics (admin/notifications domain; scheduling hooks only).

## Success Metrics

- Eval suite green on seed: routing ≥ 0.9, retrieval precision ≥ 0.7, faithfulness ≥ 0.95,
  memory continuity = 1.0, interaction-mode correctness ≥ 0.9, plan-document fidelity = 1.0.
- Chat turn first-token P95 ≤ 2.5s on seed data; full turn P95 ≤ 6s (canon latency envelope).
- 100% of module ACs ledgered and passing in `handoff/acceptance-ledger.md`.

## Implementation Priority

1. **003a chat turn** — the spine; everything else hangs off the turn loop and contract 02.
2. **003b member memory** — grounding quality gates the rest; continuity eval must be green before cadence/process work leans on recall.
3. **003c cadence** — first structured-record surface; exercises finalize + Hybrid read side.
4. **003d guided processes** — deepest state machine; consumes memory + turn loop + (later) authored definitions from PRD-006c.

## Related

- Task list: `tasks-003-coaching-surfaces.md` (this folder — generate-tasks output)
- QA report: `qa/qa-003-coaching-surfaces.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-003-coaching-surfaces-NN` rows)
