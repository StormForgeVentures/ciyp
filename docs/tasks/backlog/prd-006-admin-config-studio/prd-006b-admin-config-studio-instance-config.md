# PRD-006b: Instance & Platform Config Authoring

> Parent: prd-006-admin-config-studio-index.md | Module: Admin & Config Studio

## Goal

The ADR-002 authoring surface (feature #6, Hybrid — config-type): a coach authors their archetypes, tiers,
journeys, branding, model routing, and voice persona as per-tenant rows the runtime reads on every turn,
with every behavior-affecting write versioned and eval-gated. This sub-feature also emits the **Instance
Config** document (contract 01) the member UI consumes — it is the bridge between authoring and both
runtimes (engine + template).

## Functional requirements

1. **Archetypes** CRUD over `tenant_archetypes` (key, label, description, `prompt_fragment`, sort) — the fragment editor warns that content is prompt-injected and is validated server-side (length bounds, no template-syntax leakage).
2. **Tiers** CRUD over `tenant_tiers` (key, label, description, `entitlements_jsonb`, sort).
3. **Journeys** authoring (config-driven v1 — ordered stages as config rows; no builder canvas).
4. **Branding**: name, logo asset ref, accent tokens (stored as config; consumed via contract 01 by the template).
5. **Model routing**: slot editor over per-tenant `app_config.model_routing` rendering exactly the slot taxonomy from `docs/ai-architecture/ai-architecture.md` §2 (`default/fast/classify/deep/worker/synthesis/vision/embed/rerank/stt/tts`); provider+model pairs validated against the platform's allowed-provider list; embed slot exposes input-type discipline read-only (platform-fixed).
6. **Voice persona**: `tts.voice_id` field on the tts slot (Fish-audio clone id, provisioning-supplied; editable by operator, visible to coach).
7. **Write pipeline (every behavior-affecting write)**: persist → bump tenant prompt-set version → write `prompt_versions` row (actor + required rationale) → invalidate slot cache → invalidate per-scope assembly. Branding-only edits skip the prompt-set bump (they don't alter AI behavior) but still version for contract 01 consumers.
8. **Eval gate before go-live**: a prompt-set version becomes *live* only after the tenant's golden eval set passes against it (PRD-002d harness); until then the prior version serves. Operator override exists, is audit-logged, and is a QA finding if used outside provisioning.
9. **Instance Config emission**: `GET` endpoint serving the contract 01 document (identity, archetypes, tiers, journeys, branding, prompt-set version, UI-relevant model-routing subset), versioned, cacheable with ETag.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a coach saves an archetype `prompt_fragment` edit with a rationale, then a new `prompt_versions` row exists with actor + rationale and the tenant's prompt-set version is bumped. |
| AC-2 | Given the eval gate has not passed for the new prompt-set version, when the runtime serves the next turn, then it uses the prior live version (query: live-version pointer unchanged). |
| AC-3 | Given the eval gate passes, when the version goes live, then the next turn's trace references the new prompt-set version and the slot/assembly caches were invalidated (edit-to-live ≤ 60s P95). |
| AC-4 | Given a slot edit sets `default` to a different provider/model pair, when the next chat turn runs for that tenant, then the trace shows the new pair while a second tenant's traces are unchanged. |
| AC-5 | Given a member-UI request to the Instance Config endpoint for tenant A, then the response validates against the contract 01 zod schema and contains only tenant A content. |
| AC-6 | Given a save with an invalid slot value (unknown provider or malformed model id), then the API rejects with a field-level error and no version bump occurred. |
| AC-7 | Given a branding-only edit, then no prompt-set bump occurs but the Instance Config document version increments. |

## Data requirements

- `tenant_archetypes`, `tenant_tiers`, journey config rows, `app_config` — shapes per PRD-001b / ADR-002; this sub-feature owns their write paths.
- `prompt_versions` (PRD-002d): written here on every behavior-affecting edit; carries `prompt_set_version`, `actor`, `rationale`, diff ref.
- Live-version pointer per tenant (column on `app_config` or adjacent row): `live_prompt_set_version` — only the eval gate (or audited override) advances it.

## Endpoints

- `GET/POST/PATCH/DELETE /admin/instance/{archetypes|tiers|journeys}` — tenant-scoped, role-gated.
- `GET/PATCH /admin/instance/branding` · `GET/PATCH /admin/instance/routing` (slot editor) — same gates.
- `POST /admin/instance/activate` — runs the eval gate for the pending prompt-set version; returns pass/fail + eval snapshot ref.
- `GET /instance-config` — contract 01 emission (member-UI-facing, entitlement-agnostic identity doc; ETag).

## UI/UX

Instance section, tabbed:

```
┌ Instance ────────────────────────────────────────────────┐
│ [Archetypes] [Tiers] [Journeys] [Branding] [Routing]     │
├──────────────────────────────────────────────────────────┤
│ Archetypes                                    [+ Add]    │
│ ┌ operator ─ "Systems-first builder…"  [Edit] [History]┐ │
│ ┌ connector ─ "Relationship-led…"      [Edit] [History]┐ │
│ ...                                                      │
│ ── Pending version: v14 (evals: ⏳ running)  [Activate] ──│
└──────────────────────────────────────────────────────────┘
```

Key behaviors: every entity row exposes History (versioned edits); the pending-version bar appears whenever saved edits exist that are not yet live; Activate triggers the eval gate and streams its status; Routing tab renders one row per slot with provider/model selects and shows "requires activation" on AI-behavior slots.

## Hybrid Interface

**AI side owner:** ai-infra (ai-feature-design — cascade injection, slot resolution)
**SaaS side owner:** saas-build (this PRD's UI + write pipeline)

### Shared data shape

- **Tables:** `tenant_archetypes`, `tenant_tiers`, journey config, `app_config` (incl. `model_routing`, `live_prompt_set_version`)
- **Schema (write/read declaration):**
  - `tenant_archetypes.prompt_fragment` (text) — written by [UI] — read by [AI: cascade L3 injection] — length-bounded, plain text
  - `tenant_archetypes.{key,label,description,sort}` — written by [UI] — read by [AI (key), UI/member-UI via contract 01]
  - `tenant_tiers.*` — written by [UI] — read by [UI, member-UI via contract 01; entitlements consumed by PRD-008a]
  - `app_config.model_routing` (jsonb, slot-keyed) — written by [UI] — read by [AI: slot resolver, per scope]
  - `app_config.live_prompt_set_version` (int) — written by [eval gate only] — read by [AI: cascade/prompt assembly; member-UI via contract 01]
  - journey config rows — written by [UI] — read by [AI: cadence/process context; member-UI via contract 01]
  - branding fields — written by [UI] — read by [member-UI via contract 01 only; AI never]
- **Migration owner:** saas-build (PRD-001b created; changes migrate here)
- **Versioning policy:** any AI-read field write bumps prompt-set version + `prompt_versions` row (rule H-3, config-type); branding bumps only the Instance Config doc version; schema changes to these tables require a migration + contract 01 review.

### Write contract (UI → AI-read tables)

- Writers: the admin endpoints above only — no other service writes these tables.
- Validation: zod schemas shared with the runtime (`@ciyp/shared`); slot values checked against the allowed-provider list; fragments length-bounded and sanitized.
- Idempotency: standard row updates keyed by pk (uuid); version bumps are transactional with the row write (one transaction: row + `prompt_versions` + pending-version state).
- Failure mode: any step of the write pipeline failing rolls back the transaction; the UI surfaces the field-level or pipeline error; caches are only invalidated after commit.

### Read contract (AI → tables)

- Readers: slot resolver (`LoadSlotConfig(scope)`, cache TTL 3600s, invalidated on write); cascade assembly (archetype fragments, live version pointer) via the per-scope assembly; contract 01 endpoint (member UI, ETag-cached).
- Query patterns: pk/tenant-key lookups only — all tiny per-tenant sets; indexed `(tenant_id, key)`.
- Latency: slot resolution P95 < 10ms cached / < 100ms on miss; Instance Config endpoint P95 < 200ms.
- Caching: slot cache per scope (invalidate on write); assembly cache per scope (invalidate on write); contract 01 ETag (version-keyed).
- Permission model: admin writes role-gated within tenant (RLS); contract 01 read is per-instance public identity data (no member PII), still tenant-scoped by instance binding.

### Cross-side consistency

- **PromptVersion trigger:** every write to an AI-read field (fragments, routing, journeys, live-version pointer) — enforced in the write pipeline, not by convention (AC-1, AC-5 of the index).
- **Re-index trigger:** none (no vector content in these tables).
- **Conflict rule:** UI is the sole writer; last-writer-wins within a tenant with full version history; the eval gate is the only writer of `live_prompt_set_version`.
- **Audit trail:** `prompt_versions.actor` + `admin_audit_log` for superadmin-switched writes.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| ADR-002 tables + `app_config` | PRD-001b | Required |
| Slot resolver + invalidate | PRD-002c | Required |
| Assembly invalidation | PRD-002b | Required |
| Eval harness + `prompt_versions`/`eval_snapshots` | PRD-002d | Required |
| Contract 01 zod schema | PRD-001a | Required |
| Shell (auth, roles, audit log) | PRD-006a | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Which slots does a coach edit vs operator-only? | Letting a coach set `embed` mid-corpus breaks retrieval (re-index required) | Interim: coach edits `default/fast/deep/tts`; `embed/rerank/stt` operator-only. Revisit at P1 analytics. |
| Q-2 | Luminify archetype/tier real content (OQ-2) | Seed uses placeholders | Deferred to provisioning intake (Tim authors; not an architecture decision). |
