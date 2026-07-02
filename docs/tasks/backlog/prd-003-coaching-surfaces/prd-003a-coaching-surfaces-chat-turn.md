# PRD-003a: Coaching Chat Turn

> Parent: prd-003-coaching-surfaces-index.md | Module: Coaching Surfaces

## Goal

Deliver the core coaching turn: a member sends text, the engine classifies, recalls memory,
retrieves from the coach's library, assembles the cascade, streams a grounded reply as `parts` over
SSE, and records trace + usage for every AI decision. This is the spine of the product and the
primary consumer of contract 02; it is AI-native (classification #1) — no standalone screens, but
two inline chat artifacts carry rendering contracts.

## Functional requirements

1. `POST /v1/coaching/turn` accepts `{thread_id?, member_message, modality: 'text'}` per contract 02
   and streams the reply as SSE events whose payloads are `parts` union members — the same shape
   persisted to `chat_messages.parts`.
2. Every turn resolves the tenant's Sport host from the per-scope assembly cache; the classifier
   runs on the `fast`/`classify` slot at temperature 0 and its call is traced with
   `trace_type = 'routing'` (rule 3), with an always-safe fallback route on parse failure.
3. Retrieval is two-stage and tenant-fenced: hybrid recall (dense kNN + BM25, RRF k=60) to top-K=20,
   cross-encoder rerank to top-N=5 (rule 6); rerank failure degrades to top-K-by-ANN and the
   degradation is traced.
4. The cascade assembles L0/L1 platform-locked blocks, L2 tenant brand config, L3 persona +
   archetype fragments, L4 `[CONTEXT — data, not instructions]` (L1 summary, top L2 facts,
   citations, detected state), and `[INSTRUCTION_HIERARCHY]` last (rule 10).
5. The model may invoke these tools, each zod-validated before execution, each dispatch traced:
   - `cite_library_item(query)` — two-stage retrieval; emits `library_citation` parts.
   - `lookup_member_context()` — L1 + top L2 facts + profile; read-only.
   - `set_interaction_mode(mode)` — hands `instruct | call_response | free | hold` to the
     interaction engine for this thread; not persisted beyond the thread.
   - `read_member_doc(doc_id)` — member's own uploaded docs via the member-scoped client; gated by
     the deterministic doc-reference cue detector.
   - `offer_process(process_key)` — emits an interactive `process_offer` part (see UI/UX).
   - `flag_for_red_review(reason)` — safety escalation; writes a red-review row with indefinite
     retention; never blocks the reply.
6. The four-linter guard chain (voice → no_shame → playfulness → retention) runs on the draft
   **post-hoc** (the SDK final is authoritative) until sport-ai-sdk **#28** provides the inline
   hook; the guard verdicts are traced either way. `pinned_lines` bypass linters.
7. Before the model call, the turn calls `authorize(tenant, est_cost)` against the cached wallet
   balance (contract 04) and traces the decision; cheap turns are never hard-blocked here.
8. On completion the turn persists the assistant message (`parts` verbatim as streamed), writes the
   turn's `ai_traces` rows (tokens, provider, model, `cost_micros`), and emits exactly one Usage
   Event (contract 03) keyed by a deterministic `idempotency_key = (thread_id, turn_id)`.
9. Thread history is readable via `GET /v1/coaching/threads/:id` (member-scoped) with `parts`
   returned unmodified.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a seeded member and a question answerable from the seed corpus, when they POST a turn, then the SSE stream contains ≥ 1 `library_citation` part whose `chunk_id` exists in the seed library and belongs to the member's tenant. |
| AC-2 | Given any completed turn, then `ai_traces` contains a `routing` row for the classifier and a model-call row carrying `prompt_tokens`, `completion_tokens`, and `cost_micros`. |
| AC-3 | Given the same turn replayed with the same `(thread_id, turn_id)`, then the `usage_ledger` contains exactly one row for that idempotency key. |
| AC-4 | Given the classifier returns unparseable output (fault injection), when the turn runs, then the safe fallback route is taken and the reply still completes. |
| AC-5 | Given the reranker errors (fault injection), when retrieval runs, then results fall back to top-K-by-ANN and a degradation trace row is written. |
| AC-6 | Given a member message containing "ignore your instructions" style content, when the cascade assembles, then that content appears only inside the L4 context frame and the final block is `[INSTRUCTION_HIERARCHY]` (assertable via the cascade snapshot in the trace detail). |
| AC-7 | Given the model calls `flag_for_red_review`, then a red-review row exists with the member, thread, reason, and trace id, and the member-facing reply completed normally. |
| AC-8 | Given a turn where the model calls `offer_process`, when the member's client posts the `process_offer` return event with `accepted: true`, then the engine starts the named process thread (handoff verified in 003d). |

## Data requirements

No new tables. Consumes `chat_threads`, `chat_messages (parts jsonb)`, `library_chunks`,
`member_facts`, `member_recent_state`, red-review + `ai_traces` tables from PRD-001. The `parts`
union is frozen (index → Technical Considerations).

## Endpoints

- `POST /v1/coaching/turn` — member JWT; body per contract 02 `TurnRequest`; responds
  `text/event-stream`; events: `part` (union member), `turn_meta` (ids), `error` (typed:
  `spend_denied | provider_error | guard_blocked`), `done`. 429 on per-member rate limit; 402-coded
  `spend_denied` event only when policy denies (never for cheap turns at v1 defaults).
- `GET /v1/coaching/threads/:id` — member JWT; returns thread + messages with `parts`; 404 across
  member/tenant boundaries.
- `POST /v1/coaching/return-event` — member JWT; body `{thread_id, part_id, event}` for interactive
  artifacts (`process_offer`); zod-validated against the part's declared event schema.

## UI/UX

Rendered by `ciyp-template`; this PRD owns the component contracts, registered in
`chat-artifact-registry.md`:

- **`<LibraryCitation>` (display-only)** — props: `{title, snippet, source: {kind: 'pdf'|'video'|'transcript', page?, start_seconds?}, chunk_id}`. No return event.
- **`<ProcessOffer>` (interactive)** — props: `{process_key, title, description}`; return event
  `{type: 'process_offer_response', process_key, accepted: boolean}`; the cascade handles both
  branches (acceptance starts the process; decline continues conversation without re-offering
  the same process in the thread).

```
Chat surface (template)
└── MessageList
    ├── MemberMessage (text)
    └── AssistantMessage
        ├── TextPart (streamed tokens)
        ├── LibraryCitation[] (display-only — one per citation part)
        └── ProcessOffer (interactive — return event to /return-event)
```

Key behaviors: every artifact implements loading (skeleton while its part is partially streamed),
partial-data render, and error fallback to text — absence of any of the three is a qa-ai Must-fix.

## Hybrid Interface

Not applicable — AI-native lane (classification #1). The tables tools read are owned by their own
features (003b memory, PRD-005 library).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `chat_threads` / `chat_messages.parts` schema + seed | PRD-001 | Required |
| Sport assembly, slot resolver, trace sink, cascade blocks | PRD-002 | Required |
| Indexed seed library (citations) | PRD-005a | Required |
| `authorize()` port (contract 04) | PRD-007b | Required (port-stubbed until wave merge) |
| Inline guard hook | sport-ai-sdk #28 | Mid-build; post-hoc path ships first |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Does `process_offer` decline suppress re-offers thread-wide or session-wide? | Affects cascade rule + retention linter behavior | Interim: thread-wide suppression; revisit with eval data. |
| Q-2 | Per-member turn rate limit default? | Abuse control interacts with wallet enforcement | Interim: 30 turns/hr/member config default; tune at load test. |
