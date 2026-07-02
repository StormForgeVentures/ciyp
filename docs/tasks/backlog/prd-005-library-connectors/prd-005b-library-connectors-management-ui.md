# PRD-005b: Library Management UI

> Parent: prd-005-library-connectors-index.md | Module: Library & Connectors

## Goal

The coach-facing half of feature #7 (Hybrid): an `apps/web` surface where a coach or team admin uploads content, watches it move through the pipeline, and manages what the AI knows. This sub-PRD also owns the module's knowledge-type Hybrid Interface — the `library_documents` contract both sides build against.

## Functional requirements

1. A Library list screen shows every document in the tenant: title, source badge (`upload | vimeo | granola | fathom`), status, updated-at; sortable by status and date; polling keeps statuses live without manual refresh.
2. Upload flow: PDF direct upload; audio/video via Cloudflare Stream direct-upload URL (the UI never proxies media bytes through the API); Vimeo by URL reference. Each creates a `library_documents` row in `pending`.
3. A document detail view shows stage history, provenance fields (page/timestamp availability), failure stage + reason when `failed`, and a retry action that re-enters the failed stage.
4. Delete removes the document and (via the pipeline contract) its chunks; the UI reflects deletion immediately and the chunks are gone from retrieval within the stated latency bound.
5. All screens are tenant-scoped and admin-role-gated; a member identity can never reach these routes.
6. Imported items (from 005d) appear in the same list with their provider badge — no separate "imported content" silo.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a coach admin on the Library screen, when they upload a PDF, then a new row appears with status `pending` without a page reload. |
| AC-2 | Given a document being processed, when its status changes in the DB, then the list reflects the new status within one polling interval (≤ 10s). |
| AC-3 | Given a `failed` document, when the admin opens its detail view, then the failing stage and reason are displayed and a retry action is available. |
| AC-4 | Given an `indexed` document, when the admin deletes it, then the row is gone from the list and a retrieval query that previously cited it returns no chunks from it. |
| AC-5 | Given an authenticated member (non-admin) session, when it requests any library route or endpoint, then the response is 403/404 (Playwright + API assertion). |
| AC-6 | Given a Granola-imported document (fixture), then the list renders its `granola` source badge from the `source` field, not from title conventions. |

## Data requirements

No new tables — this surface reads/writes the 005a shapes per the Hybrid Interface below.

## Endpoints

| Method/Path | Auth | Purpose | Notes |
|---|---|---|---|
| `GET /admin/library` | tenant admin | list documents (status, source, timestamps) | paginated; P95 below |
| `POST /admin/library` | tenant admin | create document (`pending`) — pdf metadata / vimeo URL / stream-upload intent | returns Cloudflare direct-upload URL for media |
| `GET /admin/library/:id` | tenant admin | detail incl. stage history | |
| `POST /admin/library/:id/retry` | tenant admin | re-enqueue at `failed_stage` | 409 unless `status = failed` |
| `DELETE /admin/library/:id` | tenant admin | delete document + chunks | idempotent |

Errors: standard envelope; validation errors name the field; all routes RLS-scoped by tenant from the session, never from the body.

## UI/UX

Library list — the primary screen; entry point from the admin nav.

```
┌──────────────────────────────────────────────────────────┐
│ Library                                    [Upload ▾]    │
├──────────────────────────────────────────────────────────┤
│ Title                    Source     Status      Updated  │
│ ────────────────────────────────────────────────────────│
│ Q3 Group Call — Pricing  [granola]  indexed     Jul 1    │
│ Core Method Workbook     [upload]   embedding   Jul 1    │
│ Onboarding Video         [vimeo]    failed ⚠    Jun 30   │
│ ...                                                      │
└──────────────────────────────────────────────────────────┘
```

Key behaviors: status cells poll (≤10s interval, backs off when tab hidden); `failed` rows link straight to detail; Upload menu branches by source type; provider badges come from `source`.

## Hybrid Interface

**AI side owner:** ai-infra (ai-rag-design — pipeline, chunking, embedding, re-index)
**SaaS side owner:** saas-build (this sub-PRD: UI + endpoints; migrations per 005a)

### Shared data shape

- **Table:** `library_documents` (chunks are pipeline-internal; the UI never reads `library_chunks`)
- **Schema:** (full field/type detail in 005a Data requirements)
  - `id` (uuid) — written by [UI on create] — read by [both]
  - `tenant_id` (uuid) — written by [UI] — read by [both] — RLS predicate
  - `title` (text) — written by [UI] — read by [both] — AI prepends to chunks
  - `source` (enum) — written by [UI: upload/vimeo; connector importer: granola/fathom] — read by [both]
  - `source_ref` (text) — written by [UI or importer] — read by [AI worker]
  - `status` (enum) — written by [UI: only `pending` on create; worker: all other transitions] — read by [UI]
  - `failed_stage`, `failure_reason` — written by [AI worker] — read by [UI]
  - `content_hash` (text) — written by [AI worker] — read by [importer for dedupe]
- **Migration owner:** saas-build (ships with 005a schema)
- **Versioning policy:** schema changes are saas-build migrations; adding a `source` enum value requires a migration + updating 005d's importer spec. No PromptVersion trigger (knowledge-type, not config-type).

### Write contract (UI/importer → AI)

- Writers: `POST /admin/library` (UI) and the 005d importer both insert rows with `status = 'pending'`; nothing else creates documents.
- Validation before write: title non-empty ≤ 300 chars; source ∈ enum; media type/size within platform caps; Vimeo URL parseable.
- Idempotency: UI creates carry a client-generated uuid (retry-safe); importer creates are unique on `(tenant_id, source, source_ref)` with ON CONFLICT DO NOTHING (005d).
- Failure mode: insert failure surfaces as a form error; the worker never sees the row.

### Read contract (UI ← AI-advanced state)

- Surfaces: `/admin/library` (list), `/admin/library/:id` (detail); chat citations (PRD-003a) read chunks, not this table's UI fields.
- Query patterns: list by `(tenant_id, updated_at desc)` paginated; detail by pk; both covered by the 005a index plan.
- Latency: P95 < 200ms list, < 100ms detail, < 500ms delete round-trip (excluding async chunk cleanup, which completes < 30s).
- Caching: none server-side; UI polling is the freshness mechanism (≤ 10s).
- Permission model: tenant-scoped RLS; within tenant, `admin_role` holders only; members have no read path.

### Cross-side consistency

- **Re-index trigger (H-3):** any update to an `indexed` document's content (retry, re-import, edit) → worker deletes that document's chunks before re-indexing. Deletion of the document → chunks removed in the same transaction as the row delete.
- **Conflict resolution:** `status` has a single writer per phase (UI only writes `pending` at create; worker owns all subsequent transitions) — no overlapping writes by design; a UI retry action enqueues a job rather than writing status directly.
- **Audit trail:** every row carries `created_by`; worker transitions are traced (`ai_traces` ingestion events) so investigations can replay a document's pipeline history.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `library_documents` schema + worker | PRD-005a | Required |
| Admin app shell, auth, roles | PRD-006a | Required |
| Cloudflare Stream direct-upload | PRD-005a (webhook) / platform env | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Poll vs SSE for status updates? | UX freshness vs added transport surface | Decided: poll in v1 (≤10s); SSE is a P2 refinement — the wire already has SSE for chat but admin doesn't |
