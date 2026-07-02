# ADR-001 — Engine deploy topology: shared-multi-tenant now, promotable to dedicated later

**Date:** 2026-06-18 · **Status:** Accepted · **Decision owner:** Software Architect
**Supersedes:** the EL-OS single-tenant assumption (instance #1).

## Context

CIYP must serve many coaches from one codebase, where EL-OS served exactly one (Kyle, hardcoded). Two
forces pull in opposite directions:

1. **Cost & speed now.** With no coaches at scale yet, standing up a dedicated engine + dedicated DB per
   coach would multiply infra cost and make provisioning slow and operationally heavy for zero current
   benefit. We are pre-PMF for the *platform*; complexity needs evidence.
2. **Isolation later.** A high-value coach (large member base, compliance need, or contractual data
   isolation) will eventually justify — or require — a dedicated engine + dedicated DB. If the v1 design
   bakes in shared-everything assumptions, that lift becomes a rewrite.

EL-OS already pre-planned the first half of this: *"single tenant v1; to add coaches, add a `tenants`
table + tenant-scoped RLS; migrate existing data into a default tenant; major version bump."* And EL-OS
made two foundational choices that, it turns out, also unlock the *second* half:

- **UUID PKs everywhere** — explicitly chosen for sharding / sync / cross-DB refs.
- **RLS already exists per-member** as defense-in-depth.

## Decision

**v1 runtime = ONE multi-tenant engine + ONE Postgres.** Coach = tenant. Every domain table carries
`tenant_id`; RLS scopes every read/write by tenant. Per-tenant configuration (model routing, archetypes,
tiers, methods, voice) lives in **data, not code**.

**Simultaneously, design the promotion seam** so a single tenant can later be lifted into a **dedicated
engine + dedicated DB** *without a code rewrite*. Build the **seam** now; build the **dedicated
deployment** only when a coach's value justifies it.

### Why promotion is possible without a rewrite — the three enablers

1. **UUID PKs** → a row keeps its identity in any database. Copy it to a dedicated DB and every FK still
   resolves. No re-keying.
2. **Strict `tenant_id` + RLS** → "extract one tenant" is mechanically `WHERE tenant_id = $X` across the
   whole schema. There is no shared, un-scoped state to untangle.
3. **Per-tenant config is rows** → promotion copies config rows; no code fork, no per-coach branch.

### The runtime indifference seam — `tenant-context.ts`

Every request resolves a `TenantContext { tenant_id, config, db }`:

```ts
interface TenantContext {
  tenantId: string;            // uuid
  config: TenantConfig;        // per-tenant app_config (model slots, voice_id, flags)
  db: DbHandle;                // a pool handle; RLS GUC set in shared mode
  mode: 'shared' | 'dedicated';
}
```

- **Shared mode:** `db` is the shared pool; the request sets `SET LOCAL app.tenant_id = $tenantId` so RLS
  fences the transaction. `mode = 'shared'`.
- **Dedicated mode:** the deployment is single-tenant; `db` points at the dedicated DB; the RLS GUC is set
  the same way (defense-in-depth) but the DB only holds one tenant. `mode = 'dedicated'`.

**No route handler, no agent, and no eval branch on `mode`.** Tenant awareness exists only at the wiring
edge (`agent-wiring.ts`) and `tenant-context.ts`. This is what makes the runtime identical in both topologies.

### What promotion actually does (the runbook — designed, not built in v1)

1. Provision a dedicated engine deployment + empty Postgres with the **identical** schema (reuse the
   provisioning script, ADR-005 / architecture §9).
2. `COPY` or logical-replicate the tenant's rows (UUIDs intact) — driven by `WHERE tenant_id = $X` per table.
3. Repoint the coach's **Instance Config** `engine_base_url` (contract 01) at the dedicated deployment.
4. Cut over reads/writes; run a parity check (row counts + eval golden set against the dedicated instance).
5. **Confirm backup**, then drop the tenant's rows from the shared DB. *(This drop is the point of no
   return; gated behind verified parity + confirmed backup — production-mode rule.)*

### What's required *at provision time* to keep promotion cheap

- Tenant created with a UUID id; **all** tenant rows carry `tenant_id` (enforced NOT NULL + FK + RLS).
- Per-tenant `app_config` fully populated (no reliance on a shared default singleton — the singleton is gone).
- No cross-tenant foreign keys, ever. No shared mutable state keyed by anything but `tenant_id`.
- Retrieval is tenant-fenced (no global vector collection). Promotion copies the tenant's vectors with the
  tenant's rows.

## Consequences

**Positive.**
- Cheapest path to many coaches; one deployment to operate, one DB to back up.
- The promotion path is a *runbook against a seam*, not a refactor. The seam (`tenant-context.ts`,
  per-tenant config, `tenant_id` everywhere) is the entire cost, and we pay it once in v1.
- The pure agent brain (`packages/agents`) is untouched by topology — it runs identically in both modes.

**Negative / accepted.**
- **Noisy-neighbor & blast radius.** One abusive tenant can affect others; a shared-DB incident is broader.
  Mitigations: wallet **hard enforcement** (ADR-003) caps a tenant's spend; per-tenant rate limits; RLS as
  a correctness fence. Accepted for v1 because demand for isolation doesn't yet exist.
- **Cross-tenant leakage is a correctness risk** that didn't exist single-tenant. Mitigation: two-layer RLS
  (tenant fence + member fence), tenant-fenced retrieval, and a QA/security audit line item that every
  query is tenant-scoped. This is the single highest-severity class of bug in the new design.
- **The promotion runbook is designed but unbuilt in v1.** We carry the *risk* that the first real
  promotion surfaces a gap. Accepted because building it before any coach needs it is speculative.

## Alternatives rejected

- **Dedicated engine + DB per coach from day one.** Cleanest isolation, zero noisy-neighbor. Rejected:
  multiplies infra + ops cost and provisioning latency with zero current demand; over-engineering pre-PMF.
- **Shared-everything with no promotion seam (cheapest).** Rejected: the first high-value/compliance coach
  forces a rewrite. The seam is cheap insurance bought now.
- **Schema-per-tenant (one Postgres, N schemas).** A middle option. Rejected for v1: heavier migration
  fan-out (N schemas to alter per change), weaker than RLS for the promotion story (still one DB to lift
  out of), and no real isolation win over RLS. The `tenant_id` + RLS model promotes more cleanly because
  extraction is a row filter, not a schema move.
- **Citus / native sharding.** Rejected: real scale tooling for a problem we don't have; revisit only at a
  scale trigger with evidence.

## Constraint for downstream

- **Never** write a query, FK, or cache key that isn't tenant-scoped. Cross-tenant references are forbidden.
- The singleton `app_config (id=1)` is **gone** — all config reads are per-tenant via `getModelSlot(tenantId, slot)`.
- Handlers/agents/evals **must not** branch on `mode`. If you think you need to, escalate to the Architect.
- Retrieval must be tenant-fenced; no global vector collection.
