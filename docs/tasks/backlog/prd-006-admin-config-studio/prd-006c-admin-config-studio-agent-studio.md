# PRD-006c: Coach-Authored Agent Studio

> Parent: prd-006-admin-config-studio-index.md | Module: Admin & Config Studio

## Goal

The flagship (feature #5, Hybrid — config-type): a coach authors their agents as data — role identity and
persona, capability grants, tool allowlist, process directives, and L2+ prompt/cascade blocks — and
activates them into the live runtime with no deploy. Definitions persist as per-tenant rows, hydrate into
Sport primitives (`defineRole` / `defineProcess` / cascade blocks), and activation is gated by the
standard eval pack. This is the surface that makes CIYP "coaches define the agents," not "we code agents
per coach" — the EL-OS `source: 'code' | 'authored'` graduation seam, finally built.

## Functional requirements

1. **Agent (Role) authoring**: name (kebab, validated), identity, persona, capability grant (closed verb enum: `read_store / write_artifact / write_store / challenge`; `dispatch` reserved for platform-owned head roles in v1), write scope, tool allowlist, optional per-role model override (values from the tenant's configured slots only — never free-text model ids), version (auto-managed).
2. **Process directive authoring**: the `CodeProcessDefinition` shape as rows — key, title, directive text, output type, goal (structured), mode-arc beats (ordered `{id, mode, intent, loops?}`), prescriptiveness, optional pinned lines, `source='authored'`, version. Output schema selection from a platform-curated schema catalog (coach picks, never authors JSON Schema in v1).
3. **Prompt/cascade block authoring**: L2+ blocks only (`{id, content}`); L0/L1 are visible read-only with an explicit "platform-locked" marker; API rejects any write targeting locked layers (carried EL-OS refusal — including anti-sycophancy).
4. **Tools & integrations tab**: allowlist selection from the platform's curated code-tool catalog (name + description + permission requirements shown); MCP integration toggles reading `tenant_integrations` (PRD-005c) — enabling one makes its namespaced `mcp:{server}:{tool}` tools selectable.
5. **Validation with self-correction**: server-side hydration dry-run on save — rows are passed through the real `defineRole`/`defineProcess` constructors; a `RoleDefinitionError`/schema failure returns the machine-readable `aiFixHint` which the UI renders as an actionable fix suggestion next to the offending field.
6. **Version-bump-on-save is mandatory behavior**: registries throw on duplicate `{name, version}` (sport-ai-sdk #26) — every save auto-increments the definition version; there is no in-place same-version edit anywhere in the write path.
7. **Activation pipeline**: save (draft) → validate (hydration dry-run) → run the standard eval pack (interim platform-side pack until sport-ai-sdk #30: directive-faithfulness judge, goal-gate correctness, groundedness, with target/alert defaults) → on pass, flip the definition's active pointer, write `prompt_versions`, invalidate slot + per-scope assembly → next turn serves the new agent. On fail: definition stays draft with the eval report attached.
8. **Deactivation / rollback**: one-click revert to any prior version (re-runs the activation pipeline against that version — history is data, rollback is re-activation, never a mutation).
9. **Draft/test sandbox**: a coach can run a draft agent in an isolated test thread (traced, metered to their wallet, clearly marked non-member-visible) before activation.
10. **Critical-path dependency handling**: full no-deploy hydration requires sport-ai-sdk issues #25 (per-scope assembly manager), #26 (registry upsert/version semantics), #27 (config-store ports). Until resolved, the interim seam from PRD-002b (platform-side per-tenant assembly cache + loader) serves the same API contract — this sub-PRD builds against the seam, not the SDK internals, so the SDK landing is a swap, not a rework.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a coach saves a valid agent definition, then a new versioned row exists with `source='authored'`, status draft, and version = prior + 1. |
| AC-2 | Given a definition row that fails hydration (e.g. reviewer role granted both `challenge` and `write_artifact`), when the coach saves, then the API returns the `aiFixHint` payload and the UI renders it on the offending field; no draft version is created. |
| AC-3 | Given a draft agent whose eval pack has not passed, when the coach clicks Activate, then activation is refused and the active pointer is unchanged (query-verifiable). |
| AC-4 | Given a draft agent whose eval pack passes, when activation completes, then the next turn in that tenant executes the new agent version (trace shows role name + version) with no process restart. |
| AC-5 | Given an activated agent, when the coach reverts to a prior version, then the activation pipeline re-runs and the prior version serves on pass (trace-verifiable). |
| AC-6 | Given a coach in tenant A authors an agent, then tenant B's runtime and studio show no trace of it (RLS + per-scope assembly isolation). |
| AC-7 | Given a definition write targeting an L0/L1 cascade block, then the API rejects with a platform-locked error regardless of role. |
| AC-8 | Given a draft-sandbox turn, then its trace is marked test-context, it debits the tenant wallet, and it is excluded from member-facing history queries. |

## Data requirements

Definition tables (created here; hydration read path in PRD-002b):

- `tenant_agent_definitions`: `id uuid pk · tenant_id · name · version int · identity text · persona text · capability jsonb · write_scope · allowed_tools text[] · allowed_skills text[] · model_override jsonb null · status (draft|active|retired) · eval_snapshot_id null · created_by · created_at` — unique `(tenant_id, name, version)`; partial index on `(tenant_id, name) where status='active'` (one active version per name).
- `tenant_process_definitions`: the ADR-002 `coaching_process_definitions` table with `source='authored'` rows — same versioning + status discipline (PRD-003d consumes both sources).
- `tenant_cascade_blocks`: `id · tenant_id · block_key · layer int (>=2 enforced) · content text · version · status` — layer check constraint.
- `prompt_versions` rows on every activation (PRD-002d).

## Endpoints

- `GET/POST /admin/studio/agents` · `POST /admin/studio/agents/:name/activate` · `POST .../revert` — tenant-scoped, owner-gated.
- Same trio for `/admin/studio/processes` and `/admin/studio/blocks`.
- `GET /admin/studio/tools` — curated catalog + enabled MCP tools (joins `tenant_integrations`).
- `POST /admin/studio/sandbox/turn` — draft-agent test turn (SSE, test-context flag).
- All writes: hydration dry-run server-side; `aiFixHint` in the 422 payload.

## UI/UX

Agent Studio, entity-list + editor pattern:

```
┌ Agent Studio ────────────────────────────────────────────┐
│ [Agents] [Processes] [Prompt Blocks] [Tools & Integr.]   │
├──────────────────────────────────────────────────────────┤
│ daily-guide  v4 ● active   [Edit] [Test] [History]       │
│ deep-dive    v2 ◌ draft    [Edit] [Test] [Activate]      │
│                                            [+ New agent] │
├─ Editor: deep-dive v2 ───────────────────────────────────┤
│ Persona [________________________]                       │
│ Capabilities [read_store ✓] [write_artifact ✓] …         │
│ Tools [cite_library_item ✓] [mcp:granola:list ✓] …       │
│ Model override [tenant slot ▾ (default)]                 │
│ ⚠ aiFixHint: "reviewer may not both challenge and        │
│    write_artifact — remove one"                          │
│ [Save draft]                [Run evals → Activate]       │
└──────────────────────────────────────────────────────────┘
```

Key behaviors: Activate is disabled until the current draft's eval run passes (status streamed into the pending-activation tray from 006a); History renders version rows with revert actions; Test opens the sandbox thread against the draft version; locked cascade layers render with a lock glyph and no edit affordance.

## Hybrid Interface

**AI side owner:** ai-infra (ai-feature-design — hydration, standard eval pack, cascade composition)
**SaaS side owner:** saas-build (this PRD's UI + write/activation pipeline)

### Shared data shape

- **Tables:** `tenant_agent_definitions`, `tenant_process_definitions` (authored rows), `tenant_cascade_blocks`
- **Schema (write/read declaration):**
  - all definition fields above — written by [UI] — read by [AI: hydration loader at assembly build] — validated by the same zod/authoring schemas the runtime uses
  - `status` + active pointer — written by [UI via activation pipeline only] — read by [AI: loader selects active versions]
  - `eval_snapshot_id` — written by [eval gate] — read by [UI: history/evidence]
  - `model_override` — written by [UI, values restricted to tenant slots] — read by [AI: per-role resolution]
- **Migration owner:** saas-build
- **Versioning policy:** immutable versioned rows; every activation writes `prompt_versions` (H-3 config rule); definition-schema changes require a migration + hydration-loader update in the same wave (the loader and the tables are one contract).

### Write contract (UI → AI-read tables)

- Writers: studio endpoints only. Every write is a NEW version row (no in-place mutation of AI-read fields — the #26 constraint made a feature).
- Validation: hydration dry-run through the real constructors before commit; `aiFixHint` returned on failure; capability/verb enum closed; layer >= 2 check on blocks.
- Idempotency: unique `(tenant_id, name, version)`; retried saves collide on the unique key and return the existing draft.
- Failure mode: activation-pipeline failure (eval fail, invalidation error) leaves the active pointer untouched and surfaces the stage that failed; partial activations are impossible (pointer flip + prompt_versions + invalidation ordered, pointer last... pointer flips only after eval pass, invalidation after commit, and a failed invalidation triggers a retry loop with alert — never a silently stale assembly).

### Read contract (AI → tables)

- Readers: the hydration loader at per-scope assembly build (active versions only); the sandbox loader (a named draft version).
- Query patterns: `(tenant_id, status='active')` set scan at build; single-row fetches by `(tenant_id, name, version)`.
- Latency: loader adds < 50ms P95 to an assembly rebuild; rebuild itself is off the turn hot path (cached host).
- Caching: the per-scope assembly IS the cache; invalidated by activation; no independent definition cache.
- Permission model: RLS tenant fence on all three tables; studio writes owner-gated; loader reads via service role scoped by tenant context (never cross-tenant set scans).

### Cross-side consistency

- **PromptVersion trigger:** every activation and every revert (both change served behavior).
- **Re-index trigger:** none (no vector content).
- **Conflict rule:** UI is sole writer of definitions; the eval gate is sole writer of `status`→active and `eval_snapshot_id`; versions are immutable once written.
- **Audit trail:** `created_by` on every version; `prompt_versions.actor`; superadmin-switched writes also land in `admin_audit_log`.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Per-scope assembly + interim hydration seam | PRD-002b · sport-ai-sdk #25–#27 (swap-in when resolved) | Required |
| Eval harness + standard eval pack (interim until sport-ai-sdk #30) | PRD-002d | Required |
| Process runner consuming `source='authored'` | PRD-003d | Required |
| Curated code-tool catalog | PRD-002a (tool dispatcher manifest) | Required |
| `tenant_integrations` + MCP catalog | PRD-005c | Required |
| Shell + instance-config plumbing (versioning UX, tray) | PRD-006a, PRD-006b | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Can a coach create a `head` (dispatching/orchestrating) role in v1? | Multi-agent fan-out multiplies cost + eval surface | Decided: no — v1 authored agents are producers/reviewers; the platform orchestrator stays code. Revisit post-v1. |
| Q-2 | Default eval-pack targets for authored agents (conservative values) | Too-strict blocks harmless agents; too-loose ships junk | Interim: faithfulness ≥ 0.9 / goal-gate = 1.0 / groundedness ≥ 0.9, alert −0.1; tune after first real tenant (feeds sport-ai-sdk #30). |
| Q-3 | Sandbox spend cap per draft-test session | Coach could burn wallet testing | Interim: hard cap per sandbox session from platform config; surfaced in UI. |
