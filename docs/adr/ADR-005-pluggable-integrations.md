# ADR-005 — External integrations as per-tenant pluggable

**Date:** 2026-06-18 · **Status:** Accepted · **Decision owner:** Software Architect

## Context

EL-OS wires Kyle's external tools directly into the schema and runtime — notably **GoHighLevel (GHL)** CRM
via `ghl_event_*` rows. That is *Kyle's* CRM. An instance-agnostic platform cannot hardcode one coach's CRM,
nor assume every coach uses one. Coaches will also want to pull in **transcript sources** (call recordings,
session transcripts) from heterogeneous tools — ideally via **MCP** so new sources are config, not code.

Integrations are **optional per tenant** and **vary per tenant**: coach A uses GHL, coach B uses HubSpot or
nothing, coach C feeds transcripts from a tool coach A never touches.

## Decision

**Model every external integration as a per-tenant, optional, pluggable adapter behind a stable internal
port. Configuration lives in `tenant_integrations`; the runtime resolves the adapter from config, never from
a hardcoded vendor.**

- `tenant_integrations(tenant_id, id, kind, status, config_jsonb, secret_ref, created_at)` —
  `kind ∈ { crm, transcript_source, … }`, `config_jsonb` holds non-secret settings, `secret_ref` names an
  env/secret-manager key (**never** a raw secret in the DB — production secrets rule).
- **Internal ports** (TS interfaces) per integration class, e.g. `CrmPort { syncContact(), recordEvent() }`,
  `TranscriptSourcePort { listSessions(), fetchTranscript() }`. Adapters implement a port; the runtime
  depends on the port.
- **GHL becomes one CRM adapter** implementing `CrmPort`; `ghl_event_*` becomes adapter-internal, not a
  platform table. A tenant with no CRM configured simply has no CRM adapter — the runtime treats it as absent.
- **Transcript sources via MCP:** transcript-source adapters are MCP clients where possible, so adding a
  source is registering an MCP server in `tenant_integrations`, not shipping code. (MCP servers are resolved
  per tenant; a missing/failed MCP tool degrades that integration, never the core coaching loop.)
- Integration calls are **non-blocking to the coaching loop**: a CRM sync or transcript pull failing must
  not break a chat/voice turn. Failures are logged (and traced) and retried out-of-band.

## Consequences

**Positive.**
- Instance-agnostic: no coach's CRM is baked into the platform; GHL is just the first adapter.
- New integrations (a new CRM, a new transcript tool) are **adapters + config**, not core changes — and via
  MCP, often *just config*.
- Optional-per-tenant matches reality (not every coach has a CRM) and keeps the core loop dependency-free.
- Integration config travels with the tenant's rows → consistent with ADR-001 promotion (copies cleanly;
  secrets stay by reference).

**Negative / accepted.**
- A **port abstraction layer** to maintain (vs direct calls). Accepted; it's the cost of being multi-tenant
  and is small (a handful of ports).
- **MCP maturity / reliability** varies by source. Mitigation: integrations are non-blocking and degrade
  gracefully; the coaching loop never depends on them.
- Per-tenant secret management adds an ops surface (`secret_ref` resolution). Accepted; required regardless,
  and keeps secrets out of the DB.

## Alternatives rejected

- **Hardcode GHL (as EL-OS does).** Rejected: coach-specific, violates the instance-agnostic mandate.
- **One mega-integration table with vendor-specific columns.** Rejected: schema churns on every new vendor;
  the port + `config_jsonb` model absorbs new vendors without DDL.
- **No integrations in v1.** Tempting for scope. Rejected: transcript ingestion feeds the coach's body of
  work (the grounding corpus) and CRM sync is table-stakes for real coaching businesses; the *seam* must
  exist in v1 even if only one or two adapters ship.
- **Build a bespoke connector framework instead of MCP.** Rejected: MCP gives us a config-driven source
  ecosystem for free; bespoke is reinvention.

## Constraint for downstream

- No vendor name (GHL, HubSpot, etc.) appears in core runtime/schema — only behind a `*Port` adapter
  resolved from `tenant_integrations`.
- Integration secrets are stored **by reference** (`secret_ref`), never as raw values in the DB.
- Integration failures **must not** break a coaching turn (chat or voice); they degrade and retry out-of-band.
- New integration class → new port + adapter + a `tenant_integrations.kind`; never a special-case in a handler.
