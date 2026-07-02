# PRD-003d: Guided Coaching Processes

> Parent: prd-003-coaching-surfaces-index.md | Module: Coaching Surfaces

## Goal

Run a coach's structured methods as directive-driven, goal-gated conversations that end in a
persistent, member-approved document (e.g. a 90-day plan). One process-agnostic runner executes
every definition — seeded `source='code'` directives and, once PRD-006c ships the authoring
surface, `source='authored'` DB rows — with **no code change per new method**. Hybrid
(classification #4): the conversation produces artifacts; members and coaches view them on screens.

## Functional requirements

1. **One runner, N definitions.** The process runner consumes a `coaching_process_definitions`
   directive (methodology, purpose, `mode_arc` beats, constraints, prescriptiveness, goal,
   `output_type`, optional `pinned_lines`, output schema) and drives the thread through its beats
   via the interaction engine. The runner reads `source='code'` and `source='authored'` rows
   through one code path — the graduation seam is exercised from day one (fixture-authored row in
   tests even before PRD-006c ships the UI).
2. **Goal gate.** A deterministic evaluator decides completion: `doc-approved` goals require a
   rendered document AND member approval; the runner cannot finalize past an unmet gate.
3. **Document artifacts.** Document-producing processes render markdown artifacts from structured
   state (never free-generated at render time), run the fidelity check (verbatim inputs preserved,
   zero fabricated content), and persist to `coaching_process_outputs`.
4. **Approval state machine.** `draft → offered → approved | declined` — member-only transition to
   `approved`/`declined` via an interactive part; approval timestamps persist; declined docs can be
   revised (new version) and re-offered.
5. **Entry points.** A process starts from a `process_offer` acceptance (003a) or an explicit
   member action; one active process thread per member per process key.
6. **Linter discipline.** Generated lines pass the guard chain; `pinned_lines` from the directive
   bypass linters verbatim.
7. Outputs are readable by the member (own) and coach (tenant, role-gated); recent outputs are
   recallable by the AI as grounding (`get_recent_coaching_outputs` tool family).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seeded planning-method directive, when a member completes the process and approves the document, then a `coaching_process_outputs` row exists with `approval_status='approved'`, a non-null `approved_at`, and the rendered doc content. |
| AC-2 | Given the plan-document fidelity eval on the golden fixtures, then it scores 1.0 (any fabrication or dropped verbatim input fails the gate). |
| AC-3 | Given a `doc-approved` goal with no member approval yet, when the model attempts finalize, then the goal gate blocks and the thread continues in the offer beat. |
| AC-4 | Given a fixture directive row with `source='authored'`, when the runner executes it, then the process completes end-to-end with no code change (same runner path as `source='code'`). |
| AC-5 | Given a member declines the offered document, then the output row is `declined`, the thread proceeds to revision, and a re-offer creates version n+1 rather than mutating version n. |
| AC-6 | Given a directive with `pinned_lines`, when those lines are emitted, then they appear verbatim in the stream (linters bypassed) while generated lines carry guard-chain trace verdicts. |
| AC-7 | Given a member with an active process thread for key K, when they attempt to start K again, then the API returns the existing thread (409-style idempotent open). |

## Data requirements

- `coaching_process_definitions` — per-tenant directive rows (PRD-001 schema; ADR-002 §1). Fields
  mirror EL-OS `CodeProcessDefinition`: key, title, directive text, `output_type`, goal (typed),
  `mode_arc` (ordered beats), prescriptiveness, `source` (`code | authored`), version, optional
  `pinned_lines`, output schema (stored as JSON Schema for authored rows — the zod↔JSON-schema
  strategy is PRD-006c's; the runner validates against either).
- `coaching_process_outputs` — see Hybrid Interface (authoritative).
- Index: `coaching_process_outputs (tenant_id, member_id, process_key, version desc)`.

## Endpoints

- `POST /v1/processes/start` — member JWT; `{process_key}`; returns new or existing active thread.
- Turns flow through `POST /v1/coaching/turn` (003a); approval flows through the return-event
  endpoint with `{type: 'doc_approval', output_id, approved: boolean}`.
- `GET /v1/me/process-outputs?process_key=&cursor=` — member JWT; own outputs. P95 < 200ms.
- `GET /v1/admin/process-outputs?member_id=` — coach JWT, role-gated. P95 < 500ms.

## UI/UX

Template renders; contracts here. New interactive artifact registered in `chat-artifact-registry.md`:

- **`<DocApproval>` (interactive)** — props: `{output_id, title, doc_markdown, version}`; return
  event `{type: 'doc_approval', output_id, approved: boolean}`; loading/partial/error states
  required (partial = doc streams section-by-section).

```
Process thread (template chat surface)
└── AssistantMessage
    ├── TextPart (beat guidance)
    └── DocApproval (rendered doc + [Approve] [Ask for changes])
Member "My documents" screen
└── OutputList → OutputCard (title, process badge, version, approved date) → full-doc view
```

Key behaviors: approving is optimistic with rollback; a declined doc shows "revision in progress"
on the card until re-offered; document view renders the persisted markdown verbatim.

## Hybrid Interface

**AI side owner:** ai-infra (ai-feature-design — runner, goal gate, fidelity eval) · **SaaS side owner:** saas-build (outputs API + screens; definitions storage — authoring UI is PRD-006c)

### Shared data shape

- **Table:** `coaching_process_outputs` (definitions table's contract is owned by PRD-006c's
  config-type interface; this sub-PRD is its first runtime consumer)
- **Schema:**
  - `id` (uuid, pk) — written by [AI] — read by [UI] — deterministic from `(thread_id, process_key, version)`
  - `tenant_id` / `member_id` (uuid, indexed) — written by [AI] — read by [both] — RLS fences
  - `process_key` (text → definitions row) — written by [AI] — read by [both]
  - `definition_version` (int) — written by [AI] — read by [both] — pins which directive version produced it
  - `version` (int) — written by [AI] — read by [both] — output revision counter per thread+key
  - `output_type` (enum, platform mechanic) — written by [AI] — read by [both]
  - `doc_content` (text, markdown) — written by [AI] — read by [UI] — rendered verbatim
  - `structured_state` (jsonb) — written by [AI] — read by [AI] — the state the doc was rendered from (fidelity check input)
  - `approval_status` (enum: `draft | offered | approved | declined`) — written by [AI; member transition via return event] — read by [both]
  - `approved_at` (timestamptz, nullable) — written by [system on member approval] — read by [both]
  - `ai_trace_id` (uuid) — written by [AI only] — read by [UI debug]
  - `created_at` (timestamptz) — written by [AI] — read by [both]
- **Migration owner:** saas-build (PRD-001 wave)
- **Versioning policy:** outputs are append-only versioned rows; directive edits bump
  `definition_version` via prompt-set versioning (PromptVersion) on the definitions side.

### Write contract (AI → SaaS)

- Writers: the runner's `persist_process_output()` on render/offer; the return-event handler for
  the `approved | declined` transition (member-actor, recorded as such).
- Validation: `structured_state` validates against the definition's output schema; fidelity check
  passes before `offered`; `process_key` + `definition_version` must reference an existing directive.
- Idempotency: deterministic id per `(thread_id, process_key, version)`; `ON CONFLICT DO NOTHING`.
- Failure mode: persist failure returns `{ok:false}` to the tool; the cascade tells the member and
  re-attempts on the next beat; the thread never finalizes without a persisted output.

### Read contract (SaaS → AI)

- UI surfaces: member "My documents" (template); coach per-member outputs view (`apps/web`).
- Query patterns: member list `(tenant_id, member_id, created_at desc)`; latest-approved per
  process key; AI grounding reads latest N outputs by member.
- Latency: member list P95 < 200ms; coach views P95 < 500ms; AI grounding read P95 < 100ms (indexed).
- Caching: none in v1; reads are indexed.
- Permission model: RLS tenant fence; member reads own; coach role-gated tenant-wide; approval
  transition permitted only to the owning member's JWT.

### Cross-side consistency

- **PromptVersion trigger:** any `coaching_process_definitions` write (config-type: directive text,
  mode_arc, goal, pinned_lines) → prompt-set version bump + eval gate before serving (ADR-002 §4).
- **Re-index trigger:** not applicable (no vector content in v1; outputs are not embedded).
- **Conflict resolution:** approval transitions are member-only and final per version; AI never
  mutates a row post-`offered` — revisions are new versions.
- **Audit trail:** `ai_trace_id` on every AI write; approval rows record the member actor; the
  definitions row records its author (PRD-006c).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Turn loop, return events, guard chain | PRD-003a | Required |
| Interaction engine + process runner port | PRD-002 (engine port) | Required |
| Seeded directives (2 methods, `source='code'`) | PRD-001 seed | Required |
| Member memory grounding | PRD-003b | Required |
| Authored-definition authoring UI + schema strategy | PRD-006c | Later — fixture row proves the seam here |
| Fidelity + directive-faithfulness evals | PRD-002d | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | JSON Schema vs zod for authored output schemas — where does validation live? | The runner must validate both code (zod) and authored (JSON) definitions | Interim: runner validates via a JSON-Schema bridge for authored rows; final call in PRD-006c with sport-ai-sdk #27. |
| Q-2 | Can a coach retire a process with in-flight threads? | Orphaned threads vs abrupt kills | Interim: retire = no new starts; in-flight threads finish on their pinned `definition_version`. |
