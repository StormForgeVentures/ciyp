# PRD-003c: Cadence (Daily Check-in · Weekly Checkpoint · Monthly Review)

> Parent: prd-003-coaching-surfaces-index.md | Module: Coaching Surfaces

## Goal

Make coaching a rhythm, not a hotline: recurring, bounded AI-led threads (daily check-in, weekly
checkpoint, monthly review) that always conclude and always leave a structured, queryable record.
Hybrid (classification #3): the conversation writes cadence records; member history and the coach's
admin views read them.

## Functional requirements

1. Three cadence kinds ship as **directives** (config, not code): `daily_checkin`,
   `weekly_checkpoint`, `monthly_review` — seeded for Luminify; executed by the shared cadence
   runner ported from EL-OS (bounded thread + directive + forced finalize).
2. A cadence thread is **bounded**: each kind carries a max-turn budget in its directive; on budget
   exhaustion or goal completion the runner **forces finalize**, emitting a structured summary —
   threads cannot dangle open.
3. Finalize writes exactly one cadence record per `(member, kind, period)`; re-finalize attempts
   update only records still `open` (idempotent by natural key).
4. Scheduling: a worker (BullMQ) opens due cadence threads per member cadence config (timezone-aware
   period keys); members can also open the current period's check-in manually.
5. The interaction engine drives turn-taking modes per the directive's `mode_arc`
   (`instruct | call_response | free | hold`); mode transitions are traced.
6. History: members read their own cadence records; coaches read roster-level and per-member
   records (role-gated).
7. Every finalize is traced and metered like any turn (Usage Event with the record's natural key in
   the idempotency key).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seeded member with an active daily cadence, when they complete a check-in thread, then one `cadence_records` row exists for `(member, 'daily_checkin', today)` with a non-null structured `summary`. |
| AC-2 | Given a cadence thread at its max-turn budget, when the member sends another message, then the runner finalizes the thread (status `finalized`) instead of continuing. |
| AC-3 | Given two concurrent finalize attempts for the same `(member, kind, period)`, then exactly one record row exists afterward. |
| AC-4 | Given the interaction-mode-correctness eval on the seeded golden directives, then it scores ≥ 0.9 (alert 0.8). |
| AC-5 | Given a member with timezone America/Chicago, when the scheduler runs at 00:30 UTC, then no new daily thread opens until the member's local day boundary (period-key test). |
| AC-6 | Given a coach of tenant A, when they list cadence records, then only tenant-A rows return; a member sees only their own. |
| AC-7 | Given the seeded expired-entitlement member, when the scheduler runs, then no cadence thread opens for them (entitlement gate). |

## Data requirements

- `cadence_records` — see Hybrid Interface (authoritative).
- `member_cadence_config` — per member: kinds enabled, local timezone, preferred hour; written by
  member settings (template) / coach admin; read by scheduler.
- Cadence directives live in `coaching_process_definitions`-family config (PRD-001 schema; authored
  variants arrive via PRD-006c) — this sub-PRD consumes them.
- Index: `cadence_records (tenant_id, member_id, kind, period_key desc)` — serves member history and
  roster queries (rule 5: filters on indexed fields only).

## Endpoints

- `POST /v1/cadence/open` — member JWT; `{kind}`; opens (or returns) the current period's thread;
  409 if already finalized for the period.
- Turns flow through the standard `POST /v1/coaching/turn` (003a) with the cadence thread id.
- `GET /v1/me/cadence?kind=&cursor=` — member JWT; paginated history. P95 < 200ms.
- `GET /v1/admin/cadence?member_id=&kind=` — coach JWT (role-gated); roster + per-member views.
  P95 < 500ms.

## UI/UX

No new engine-side frontend; template renders. Contract highlights:

```
Member history (template)
└── CadenceHistoryList
    ├── PeriodCard (kind badge, period label, summary highlights, score chip)
    └── ... (paginated, newest first)
```

Key behaviors: an open thread for the current period deep-links back into chat; finalized cards are
read-only; empty state prompts the first check-in (new-member seed exercises it).

## Hybrid Interface

**AI side owner:** ai-infra (ai-feature-design — cadence directives + finalize tool) · **SaaS side owner:** saas-build (records API, history/roster surfaces, scheduler)

### Shared data shape

- **Table:** `cadence_records`
- **Schema:**
  - `id` (uuid, pk) — written by [AI] — read by [UI] — deterministic from `(member_id, kind, period_key)`
  - `tenant_id` (uuid, indexed) — written by [AI] — read by [both] — RLS fence
  - `member_id` (uuid, indexed) — written by [AI] — read by [both] — RLS fence
  - `kind` (text, references cadence directive key) — written by [AI] — read by [both] — config-driven, not an enum (ADR-002 rule of thumb: coaches may rename/extend kinds)
  - `period_key` (text, e.g. `2026-07-02` / `2026-W27` / `2026-07`) — written by [AI] — read by [both] — member-local period
  - `thread_id` (uuid, fk) — written by [AI] — read by [UI] — deep-link to the conversation
  - `status` (enum: `open | finalized | expired` — platform mechanic) — written by [AI/scheduler] — read by [both]
  - `summary` (jsonb, shape versioned per directive version) — written by [AI] — read by [UI]
  - `scores` (jsonb, e.g. self-status indices) — written by [AI] — read by [UI] — drives trend rendering
  - `ai_trace_id` (uuid) — written by [AI only] — read by [UI debug]
  - `created_at` / `finalized_at` (timestamptz) — written by [AI] — read by [both]
- **Migration owner:** saas-build (PRD-001 wave)
- **Versioning policy:** `summary`/`scores` shapes are versioned with the directive version; a directive change bumps prompt-set version → `PromptVersion` record; schema change = migration.

### Write contract (AI → SaaS)

- Writer: the cadence runner's `finalize_cadence(summary, scores)` tool call — the only writer of
  `finalized` rows; the scheduler writes `open`/`expired` transitions.
- Validation: `kind` must exist in the tenant's directives; `summary` validates against the
  directive's output schema; `period_key` matches the member-local current period.
- Idempotency: natural key `(member_id, kind, period_key)` unique index; `ON CONFLICT` updates only
  rows still `open`.
- Failure mode: finalize write failure retries once; on second failure the thread stays `open`,
  a trace error row is written, and the scheduler's sweep re-attempts finalize next run.

### Read contract (SaaS → AI)

- UI surfaces: member history (`/me/cadence` in template); coach roster + per-member views
  (`apps/web` admin). The AI also reads recent records via `get_recent_coaching_outputs`-family
  tools for grounding.
- Query patterns: member timeline `(tenant_id, member_id, kind, period_key desc)`; roster "latest
  per member" aggregate; trend queries over `scores` for the last N periods.
- Latency: member history P95 < 200ms; roster/aggregate P95 < 500ms.
- Caching: none in v1 (indexed reads suffice); scheduler reads uncached.
- Permission model: RLS tenant fence; members read own rows only; coach reads all tenant rows
  (role-gated); no cross-tenant path.

### Cross-side consistency

- **PromptVersion trigger:** any edit to a cadence directive (this is a config-type hybrid on the
  definitions side) — prompt-set version bumps and the eval gate runs before the new directive serves.
- **Re-index trigger:** not applicable (no vector content).
- **Conflict resolution:** rows are AI-append-only; members and coaches never write records. Corrections = a compensating record version, never an in-place edit.
- **Audit trail:** `ai_trace_id` on every record; `status` transitions traced.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Turn loop + interaction engine | PRD-003a / PRD-002 | Required |
| Cadence directives seeded (2 kinds min) | PRD-001 seed | Required |
| BullMQ worker infra | PRD-002 | Required |
| Entitlement check at thread open | PRD-008a (port-stubbed until wave merge) | Required |
| Authored directives read path | PRD-006c | Later — code-sourced directives suffice for this sub-PRD |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Do missed periods backfill (`expired` rows) or stay absent? | Trend math + streak UX depend on it | Interim: scheduler writes `expired` rows on period close for enabled kinds — explicit gaps beat implicit ones. |
| Q-2 | Member-configurable cadence hour granularity? | Scheduler load shape | Interim: hour-of-day only, member timezone; finer-grained deferred. |
