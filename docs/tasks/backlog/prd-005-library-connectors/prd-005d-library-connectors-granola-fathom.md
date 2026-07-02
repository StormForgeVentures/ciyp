# PRD-005d: Granola & Fathom Providers

> Parent: prd-005-library-connectors-index.md | Module: Library & Connectors

## Goal

Feature #8 (Hybrid, P0 per decision #10): the first two providers on the 005c framework. A coach connects Granola or Fathom, browses their meetings, selects which to import, and each imported transcript flows through the 005a pipeline as provenance-tagged library content — making "the AI knows my actual client conversations" real. Pure consumer of 005a + 005c: provider-specific code is acquisition only (list meetings, fetch transcript); everything downstream is the existing pipeline.

## Functional requirements

1. Provider adapters for Granola and Fathom implementing a common `TranscriptProvider` port: `listMeetings(scope, cursor, filters)` and `fetchTranscript(scope, meetingRef)` — MCP-served or platform code per 005c; never coach-authored logic.
2. Import selection UI: from a connected provider card, the coach browses meetings (title, date, duration, folder where the provider exposes one) and selects meetings — individually or by folder — for import; selection is explicit (no auto-import in v1).
3. Each selected meeting creates a `library_documents` row (`source = granola|fathom`, `source_ref =` provider meeting id, `status = pending`) and hands off to the 005a pipeline; transcript text enters at the `chunking` stage (no re-transcription of an already-textual transcript).
4. Re-importing is idempotent: unique `(tenant_id, source, source_ref)` with ON CONFLICT DO NOTHING; a changed transcript (provider-side edit) re-imports only via an explicit "re-import" action, which triggers delete-then-re-index (H-3).
5. Import runs are background jobs with per-meeting outcomes (imported / skipped-duplicate / failed) surfaced in the UI; provider API failures mark the run item failed without poisoning other items.
6. Provider API usage is rate-limited per tenant and traced (connector-health metrics feed 005c's card).
7. Import fidelity is deterministically evaluable: the transcript text fetched equals the concatenated chunk content for that document (modulo chunk overlap/title prefixes).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a connected Granola integration (fixture-backed double in CI), when the coach opens Import meetings, then the meeting list renders provider titles/dates from `listMeetings`. |
| AC-2 | Given three selected meetings, when the import runs, then three `library_documents` rows exist with `source = 'granola'` and each reaches `indexed`. |
| AC-3 | Given a meeting already imported, when the same meeting is selected again, then no duplicate document is created and the run item reports skipped-duplicate. |
| AC-4 | Given an imported, indexed transcript, when the fidelity eval runs, then 100% of transcript sentences are reachable in that document's chunk contents. |
| AC-5 | Given a member chat question answered by imported-meeting content, when the turn completes, then the `library_citation` part resolves to the imported document (provenance survives to citation). |
| AC-6 | Given the Fathom API returning 500 for one meeting in a five-meeting run, when the run completes, then four items are imported and one is failed with a reason — the run is not aborted. |
| AC-7 | Given an explicit re-import of a provider-edited transcript, when it completes, then the document's chunks are fully replaced (no stale chunks from the prior version). |

## Data requirements

| Entity | Field | Type | Notes |
|---|---|---|---|
| `import_runs` | `id` uuid pk, `tenant_id` (idx), `integration_id` FK, `started_by`, `started_at`, `finished_at` | | one row per coach-initiated import |
| `import_run_items` | `id` uuid pk, `run_id` FK (idx), `source_ref` text, `outcome` enum `imported \| skipped_duplicate \| failed`, `document_id` FK nullable, `failure_reason` text nullable | | per-meeting outcome |
| `library_documents` | — | — | gains no new columns; unique index `(tenant_id, source, source_ref)` where `source_ref` is not null (ships here if not in 005a) |

## Endpoints

| Method/Path | Auth | Purpose |
|---|---|---|
| `GET /admin/integrations/:provider/meetings?cursor=&folder=` | tenant admin | proxy `listMeetings` (rate-limited, never cached beyond 60s) |
| `POST /admin/integrations/:provider/import` | tenant admin | body: meeting refs or folder ref → creates `import_runs` + items, enqueues |
| `GET /admin/import-runs/:id` | tenant admin | run progress + per-item outcomes |
| `POST /admin/library/:id/reimport` | tenant admin | explicit re-import (H-3 path); 409 unless document `source ∈ {granola, fathom}` |

## UI/UX

Import selection (reached from the 005c provider card):

```
┌──────────────────────────────────────────────────────┐
│ Import from Granola                        [Import 3]│
├──────────────────────────────────────────────────────┤
│ Folder: [Client Sessions ▾]                          │
│ ☑ Kickoff — Jane D.        Jun 24 · 52m              │
│ ☑ Weekly — Marcus T.       Jun 26 · 31m              │
│ ☑ Strategy — Jane D.       Jun 30 · 47m   imported ✓ │
│ ☐ Internal standup         Jul 1  · 12m              │
│ ...                                                  │
└──────────────────────────────────────────────────────┘
```

Key behaviors: already-imported meetings render a badge and default unchecked; Import enqueues and routes to a run-progress view (per-item outcomes, polling); folder filter only where the provider exposes folders (Granola yes, Fathom TBD per adapter capability flag).

## Hybrid Interface

Extends the module's two existing contracts rather than defining a third shape:

- **Knowledge side (005b's `library_documents` contract):** the importer is the second authorized writer of `pending` rows (write contract already lists it); provenance fields `source`/`source_ref` are importer-written, UI-read; idempotency is the `(tenant_id, source, source_ref)` unique key (rule H-2 — named, not assumed); re-import → delete-then-re-index (H-3).
- **Config side (005c's `tenant_integrations` contract):** `config.folder_defaults` (jsonb) is UI-written, importer-read; provider health fields are importer-written, UI-read.
- **Run telemetry:** `import_runs`/`import_run_items` are importer-written, UI-read; read pattern is by-run-id polling, P95 < 200ms; tenant + admin-role scoped like all module surfaces; every item row records the acting integration and initiating admin (audit trail).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Connector framework (vault, states, MCP catalog, provider cards) | PRD-005c | Required |
| Ingestion pipeline (chunking-stage entry for textual transcripts) | PRD-005a | Required |
| Library list provenance badges | PRD-005b | Required |
| Granola / Fathom developer API access + fixtures | external | Required — see risk R-1 |

**R-1 (external constraint):** Granola and Fathom API surfaces/quotas are third-party and less battle-tested than QBO's; capability differences (folders, transcript formats, pagination) live behind the `TranscriptProvider` port with per-adapter capability flags, and CI runs on fixture-backed doubles so provider drift breaks an adapter test, not the suite.

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Fathom API access tier (official API vs export-based)? | Determines adapter shape and whether folder filtering exists | Resolve during 005c build; adapter port isolates the answer |
| Q-2 | Auto-import new meetings from a watched folder? | Coaches will ask; changes consent expectations + spend profile | Deferred (explicitly out of scope v1 — poll/select only); revisit with wallet data after launch |
| Q-3 | PII handling for client names in transcripts? | Member-adjacent PII entering the library corpus | Interim: transcripts are coach-owned content under the tenant fence (same class as uploads); flag to security review for the governance/minimization pass |
