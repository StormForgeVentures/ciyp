# PRD-006: Admin & Config Studio

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

Give every coach (and the Luminify operator) a multi-tenant web console that is the single authoring
surface for their instance: who they are (archetypes, tiers, journeys, branding, voice), how their AI
runs (model routing), and — the flagship — the agents themselves (roles, process directives, prompt
blocks, tool selections) authored as per-tenant configuration that takes effect **without a deploy**.
Three distinct concerns: (1) the tenant-scoped admin shell with role-gated access, (2) instance/platform
config authoring per ADR-002, (3) the coach-authored agent studio per ADR-006 §4. This module is what
turns "adding a coach" into content/config authoring instead of a code change, and it unblocks
provisioning (PRD-008) and the member UI's Instance Config feed (contract 01).

### Scope

| In scope | Out of scope |
|----------|--------------|
| Coach/admin authentication + tenant-scoped session (Supabase Auth) | Member-facing surfaces of any kind (decision #11 — member web = template PWA) |
| Superadmin tenant management (create/suspend/list) + tenant switcher | Self-serve coach onboarding (P2 — provisioning is a runbook, PRD-008) |
| Archetype / tier / journey / branding authoring (ADR-002 de-enum tables) | Drag-and-drop journey builder (config-driven v1, brief non-goal) |
| Model-routing slot editor over per-tenant `app_config.model_routing` | Editing platform-locked cascade layers L0/L1 (hard refusal, carried from EL-OS) |
| Voice persona (`tts.voice_id`) configuration | Voice clone creation/upload workflow (Fish-audio side, provisioning intake) |
| Coach-authored agent studio: roles, process directives, cascade blocks, tool allowlists, MCP integration toggles | Coach-authored **tool logic** (out of scope by design — code tools or MCP servers only, ADR-006) |
| Activation pipeline: version bump → eval pack gate → per-scope invalidation | Prompt management/versioning UI beyond activation history (feature #16, P1) |
| Instance Config (contract 01) emission endpoint | Wallet funding/monitoring screens (PRD-007) · usage analytics dashboards (P1) |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 006a | `prd-006a-admin-config-studio-shell.md` | Admin app shell: auth, tenant management, role gates, tenant switcher (Traditional) |
| 006b | `prd-006b-admin-config-studio-instance-config.md` | Instance/platform config authoring + Instance Config contract emission (Hybrid, config-type) |
| 006c | `prd-006c-admin-config-studio-agent-studio.md` | Coach-authored agent studio: definitions-as-rows, eval-gated activation (Hybrid, config-type) |

## Personas

- **Luminify operator (superadmin)** — Tim/team; provisions and maintains coach tenants; needs cross-tenant visibility, tenant lifecycle controls, and the ability to act inside any tenant deliberately (switcher, audit-logged).
- **Coach** — owner-admin of one tenant; authors their identity config and their agents; needs safe self-service (validation, eval gates, versioned history) with zero deploy knowledge.
- **Coach's team admin** — delegated admin inside one tenant (`admin_role` gated); manages content/config subsets the coach grants; never sees another tenant.
- **Developer agents** — build against this PRD; consume the ADR-002 table shapes and the PRD-002 assembly/slot invalidation seams.

## Module-level acceptance criteria

The criteria that span the whole module. Sub-feature criteria live in their sub-PRD. Each verifiable by an agent (a test, a Playwright flow, a query).

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a coach admin authenticated to tenant A, when they navigate any admin route or call any admin API, then only tenant A rows are readable or writable (cross-tenant probe returns 404/403 and an RLS test proves zero rows). |
| AC-2 | Given the Luminify operator (superadmin role), when they open tenant management, then all tenants are listed and the switcher establishes an audit-logged session scoped to the selected tenant. |
| AC-3 | Given a running engine serving tenant A, when an admin saves a model-routing slot change, then the next AI call for tenant A resolves the new slot value without any process restart or deploy (slot cache invalidated on write). |
| AC-4 | Given a coach-authored agent definition that has not passed its eval pack, when the coach attempts activation, then activation is refused and the agent's prior version (or absence) continues serving. |
| AC-5 | Given any behavior-affecting config write (archetype prompt_fragment, cascade block, model slot, agent definition, process directive), then a new `prompt_versions` row exists recording actor, rationale, and the prompt-set version bump. |
| AC-6 | Given tenant A and tenant B with different `model_routing` values, when the same chat flow runs in each, then traces show each tenant's configured model with zero code differences (per-scope config proof, shared with PRD-002 AC). |

## Core UX per Surface

- **Admin web (`apps/web`, coach/admin only)** — left-nav console: Dashboard · Instance (archetypes, tiers, journeys, branding, voice) · Agent Studio (agents, processes, prompt blocks, tools & integrations) · Library (PRD-005 surface slot) · Wallet (PRD-007 surface slot) · Settings (team, tenant). Dense, form-first authoring screens with per-entity version history panels and a persistent "pending activation" tray showing eval-gate status. Superadmin gains a tenant switcher in the top bar and a Tenants section. Structure and function only — visual design belongs to the Designer.

## Technical Considerations

**Per-scope invalidation fan-out.** A config write must invalidate two caches in order: the slot/config cache (PRD-002c `invalidate(scope)`) and the per-tenant assembly cache (PRD-002b) — a stale assembly can outlive a fresh slot read. The write path is: persist row → bump prompt-set version (+ `prompt_versions`) → invalidate slot cache → invalidate assembly for that scope. Skipping the assembly step is the failure mode that makes edits "randomly" not take effect; it is an integration test, not a convention.

**Platform-locked cascade layers.** L0 (system foundation) and L1 (platform voice + anti-sycophancy) are not tenant-editable and the anti-sycophancy block is explicitly not configurable — EL-OS's in-code refusal carries forward as an API-level rejection, not just missing UI. The studio edits L2+ only (architecture §5.2).

**Eval gate is structural, not procedural.** The runtime refuses eval-less processes (Sport no-eval-no-ship), so the studio cannot treat evals as optional metadata: activation without an attached, passing eval pack does not degrade — it throws at registration. The UI must therefore model "draft → validating → eval-running → active/failed" as real states.

### Security

Supabase Auth required on every route; role gates via `admin_role` (platform enum, ADR-002 §2); tenant scoping by RLS with the request-ALS scope pattern (no tenant id accepted from the request body); superadmin actions inside a tenant are audit-logged with actor + reason; all config writes validated server-side (zod, matching the Sport authoring schemas) regardless of client validation; MCP/OAuth secrets are never returned to the client after write (PRD-005c vault rules); rate-limit config-write endpoints (they trigger eval runs, which cost money).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants`, `app_config`, ADR-002 config tables, `admin_role` enum | PRD-001b | Required |
| Luminify seed (real config rows to render) | PRD-001c | Required |
| Slot resolver + `invalidate(scope)` | PRD-002c | Required |
| Per-tenant assembly cache + invalidation | PRD-002b | Required |
| Eval harness (runs the activation gate) | PRD-002d | Required |
| `prompt_versions` / `eval_snapshots` tables | PRD-002d | Required |
| `tenant_integrations` rows (MCP toggles read these) | PRD-005c | Required |
| Definition hydration (defineRole/defineProcess read path) | PRD-002b · sport-ai-sdk issues #25–#27 (interim seam until resolved) | Required |
| Instance Config contract schema (contract 01) | PRD-001a (`@ciyp/shared`) | Required |

## Non-Goals

- No member-facing area in `apps/web` (decision #11).
- No coach-authored tool logic — tools are curated code tools or MCP servers (ADR-006).
- No editing of platform-locked cascade layers (L0/L1) or platform-mechanic enums.
- No self-serve tenant creation (provisioning is operator-run, PRD-008).
- No prompt-diff analytics/experimentation UI (P1 feature #16).
- No native IAP, no billing screens here (PRD-007 owns wallet UX).

## Success Metrics

- A new coach's full instance config + at least one custom agent authored end-to-end through the UI with zero engineer involvement (provisioning dry-run, PRD-008 rehearsal).
- 100% of behavior-affecting writes carry a `prompt_versions` row (AC-5 query audited in QA).
- Config-edit-to-live latency ≤ 60s P95 (write → next-turn visibility), with zero deploys.
- Zero cross-tenant access findings in the module security audit.

## Implementation Priority

1. **006a shell** — everything else renders inside it; auth + tenant scoping are the security spine QA verifies first.
2. **006b instance config** — unblocks contract 01 emission (member UI), provisioning intake, and proves the invalidation fan-out on the simplest config shapes.
3. **006c agent studio** — the flagship; lands last because it composes 006b's versioning/eval plumbing with PRD-002's hydration seam and PRD-005c's integrations; its interim path (pre sport-ai-sdk #25–#27) must not block 006a/006b.

## Related

- Task list: `tasks-006-admin-config-studio.md` (this folder — generate-tasks output)
- QA report: `qa/qa-006-admin-config-studio.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-006-admin-config-studio-NN` rows)
