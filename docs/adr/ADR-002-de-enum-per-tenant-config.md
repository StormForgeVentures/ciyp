# ADR-002 — De-enum & per-tenant instance config

**Date:** 2026-06-18 · **Status:** Accepted · **Decision owner:** Software Architect

## Context

EL-OS encodes coach Kyle Brown's methodology directly into the schema as **enums** and into a
**singleton** `app_config (id=1)`. Three enum families encode Kyle's IP specifically:

- `archetype` — reconnector / stabilizer / integrator / self_led / embodied_leader
- `enrollment_tier` — catapult / mastermind / concierge
- coaching-method `agent_kind` — pmm / harmonizer / five_planes

`ciyp-platform` is **instance-agnostic by mandate**: nothing client-coach-specific may live in this repo.
A platform serving many coaches cannot hardcode one coach's archetypes, tiers, or methods. At the same
time, EL-OS already proved the *escape hatch*: **Decision #25** made coaching methods config-driven —
`coaching_process_definitions` is an **admin-authored directive** (methodology / purpose / mode_arc /
constraints / examples), *not* a per-line script; "new methodologies are added as content/config, not
code." We generalize that proven pattern across the whole coach-specific surface.

## Decision

**Move every coach-specific enum to per-tenant configuration rows; keep platform-mechanic enums as enums;
make `app_config` per-tenant.**

### 1. De-enum the three Kyle-specific families

| EL-OS enum | v1 |
|---|---|
| `archetype` | `tenant_archetypes(tenant_id, id, key, label, description, prompt_fragment, sort)` |
| `enrollment_tier` | `tenant_tiers(tenant_id, id, key, label, description, entitlements_jsonb, sort)` |
| method `agent_kind` | `coaching_process_definitions(tenant_id, …)` directives (reuse Decision #25) |

A member's archetype/tier becomes an FK to a **tenant-scoped config row**, not an enum value. The cascade
injects the archetype's `prompt_fragment` rather than branching on a hardcoded enum.

### 2. Keep generic enums as enums

These encode **platform mechanics, not coach IP**, and stay as Postgres enums (cheap, type-safe,
shared semantics across all tenants):

`enrollment_status`, `admin_role`, `user_kind`, `push_platform`, `chat_thread_state`,
`chat_message_role`, `interaction_mode` (instruct / call_response / free / hold),
`coaching_process_modality` (voice / guided / text), `coaching_process_output_type`/`source`,
`member_fact_tier`/`source`, `member_recent_state_reason`.

Rule of thumb: **if a coach would ever want to name it differently, it's config. If it's a state machine
the engine reasons over, it's an enum.**

### 3. `app_config` becomes per-tenant

EL-OS's `app_config (id=1)` singleton holding `model_routing` JSONB becomes **one row per tenant**. The
slot shape is unchanged: `{chat, fast, deep, vision, embedding, rerank, stt, tts}`, each `{provider,
model, …}`. **`tts.voice_id` is the per-coach voice persona** (Fish-audio clone). All reads go through
`getModelSlot(tenantId, slot)` — cached per tenant, invalidated on that tenant's config update (EL-OS
already had the cache + invalidation; we key it by tenant).

### 4. Authoring surface

The coach/admin **web console** (`apps/web`) is the authoring surface for archetypes, tiers, method
directives, model routing, and voice. Config edits are **versioned** and feed the **prompt-set version**
in Instance Config (contract 01) → which feeds `prompt_versions` + `eval_snapshots`. A coach therefore
cannot change behavior without an eval-able audit trail. (Reuses EL-OS's synchronous-write,
rationale-required `prompt_versions` discipline.)

## Consequences

**Positive.**
- The repo carries zero coach IP — instance-agnostic mandate satisfied.
- Adding a coach is **content/config authoring**, not a code change or a deploy.
- Config travels with the tenant's rows → directly enables ADR-001 promotion (config copies cleanly).
- Reuses an already-proven pattern (Decision #25) rather than inventing a config system.

**Negative / accepted.**
- Config-driven prompt fragments are **less type-safe** than enums — a coach can author a bad
  `prompt_fragment`. Mitigation: the cascade + linters still gate generated lines; config edits are
  eval-gated before go-live (no eval, no ship).
- More joins (member → tenant_archetypes) than an enum lookup. Negligible at v1 scale; archetypes/tiers are
  tiny per-tenant sets, cached.
- A migration is required to convert existing enum columns to FK columns (see the multi-tenant migration,
  architecture §4.1) — but in *this* repo there is no Kyle data to convert (seed is Luminify), so the
  conversion is greenfield, not a backfill.

## Alternatives rejected

- **Keep the enums, ship one repo per coach.** Rejected: that's EL-OS per coach — the rebuild we're
  explicitly avoiding.
- **Global config table with a coach-name discriminator column** (not per-tenant rows). Rejected: same
  noisy-neighbor/leak surface, worse for the promotion story (config wouldn't lift out by `tenant_id`).
- **Fully dynamic everything (no enums at all).** Rejected: over-generalization. Platform state machines
  (`chat_thread_state`, `interaction_mode`) are engine logic; making them config invites tenants to break
  the runtime and bloats the eval surface. Keep the mechanic enums.

## Constraint for downstream

- No new coach-specific enum may be added to this repo. New coach-variable concept → per-tenant config row.
- `getModelSlot()` always takes a `tenantId`. There is no global model-routing read.
- Config edits that change AI behavior must bump the prompt-set version and pass the eval gate before go-live.
