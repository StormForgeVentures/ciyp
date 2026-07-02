# PRD-005a: Ingestion Pipeline

> Parent: prd-005-library-connectors-index.md | Module: Library & Connectors

## Goal

Port and generalize EL-OS's staged library-ingestion worker so any tenant's content — PDF, uploaded media, Vimeo reference, or (via 005d) imported meeting transcript — becomes tenant-fenced, retrievable chunks. The pipeline is the module's engine: one path from raw content to indexed vectors, resumable per stage, with provenance preserved so citations can point back to a page or a timestamp.

## Functional requirements

1. A BullMQ-backed worker advances each `library_documents` row through the ordered stages `pending → extracting → transcribing → chunking → embedding → indexed`, persisting each transition; a stage that does not apply to a source (e.g. `transcribing` for PDF) is skipped with the skip recorded.
2. A worker crash or restart resumes from the last persisted stage; re-running a completed stage is a no-op (stage idempotency).
3. Any stage failure sets status `failed` with `failed_stage` and a machine-readable `failure_reason`; retry re-enters at the failed stage.
4. Source acquisition supports: PDF text extraction; uploaded audio/video via Cloudflare Stream direct upload + webhook, transcribed with Deepgram batch (via the `stt` slot); Vimeo reference (caption/plain-text fetch).
5. Chunking follows the canon default: recursive character splitting ~500 chars with 20% overlap, title-prepended; timed transcripts carry `start_seconds`, PDFs carry `page_number` on each chunk.
6. Embedding uses the `embed` slot with **`input_type: 'document'`** at index time (asymmetric embedding — query-side is PRD-002b's concern); dimension comes from slot config, never a literal.
7. Every chunk row carries `tenant_id`, and all vector writes/reads go through the PRD-002b vector-store port (rule 4 two-layer fencing).
8. Updating or re-importing a document **deletes the document's existing chunks before re-indexing** (delete-then-re-index, hybrid-interface rule H-3) — stale-chunk accumulation is a Must-fix.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a `library_documents` row in `pending` for an uploaded PDF, when the worker runs to completion, then the row reaches `indexed` and its chunks exist with `page_number` provenance and `tenant_id` set. |
| AC-2 | Given a document mid-pipeline at `chunking`, when the worker process is killed and restarted, then processing resumes at `chunking` and the final chunk set is identical to an uninterrupted run. |
| AC-3 | Given a Deepgram transcription stage that throws, when the worker handles the error, then the document status is `failed` with `failed_stage = 'transcribing'` and a retry re-enters at `transcribing`. |
| AC-4 | Given an `indexed` document, when it is updated and re-ingested, then no chunk from the prior version remains queryable (chunk count and ids fully replaced). |
| AC-5 | Given an uploaded audio file, when ingestion completes, then each chunk from the transcript carries `start_seconds` and the embed call was made with `input_type: 'document'` (assertable via the trace row). |
| AC-6 | Given a chunk write, when it is inserted, then a missing `tenant_id` is rejected by schema constraint (NOT NULL + RLS), not by application convention. |

## Data requirements

| Entity | Field | Type | Notes |
|---|---|---|---|
| `library_documents` | `id` | uuid pk | UUID for promotion-safety (ADR-001) |
| | `tenant_id` | uuid, FK `tenants`, indexed | RLS predicate |
| | `title` | text | prepended to every chunk |
| | `source` | enum `upload \| vimeo \| granola \| fathom` | provenance; connectors extend via 005d |
| | `source_ref` | text nullable | Cloudflare Stream uid / Vimeo id / provider meeting id |
| | `status` | enum `pending \| extracting \| transcribing \| chunking \| embedding \| indexed \| failed` | stage machine; platform enum (ADR-002 "engine reasons over it") |
| | `failed_stage` / `failure_reason` | text nullable | set only when `status = failed` |
| | `content_hash` | text | idempotency for re-import (005d dedupe joins on `(tenant_id, source, source_ref)`) |
| | `created_by` / timestamps | | audit |
| `library_chunks` | `id` | uuid pk | |
| | `tenant_id` | uuid, indexed | duplicated onto chunk for rule-4 payload filtering |
| | `document_id` | uuid FK, indexed | delete-then-re-index cascade target |
| | `chunk_index` | int | order within document |
| | `content` | text | title-prepended |
| | `embedding` | vector(1024) | dim from slot config at migration time; HNSW index |
| | `tsv` | tsvector, GIN | sparse/BM25 leg (architecture §4.4) |
| | `start_seconds` | numeric nullable | timed transcripts |
| | `page_number` | int nullable | PDFs |

Migration discipline: additive tables; RLS in the same migration; indexes ship with the schema (architecture §4.1).

## Endpoints

No new public endpoints — the pipeline is worker-side. Internal surface: the Cloudflare Stream webhook route (`POST /webhooks/cloudflare-stream`, signature-verified, advances `source_ref`-matched documents out of upload wait) — idempotent on webhook redelivery.

## UI/UX

No frontend changes in this slice (the UI is 005b).

## Hybrid Interface

Feature #7's canonical Hybrid Interface (shared shape, write/read contracts, P95s, permissions) lives in **005b** — this sub-PRD does not duplicate it. Pipeline-side obligations under that contract: the worker is the only writer of `status` transitions beyond `pending`; every update to a source document triggers delete-then-re-index of its chunks (H-3 knowledge rule); `failure_reason` is always machine-readable so the UI can render it without parsing prose.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants` + RLS baseline | PRD-001b | Required |
| Embedder/vector-store ports, trace-sink | PRD-002b | Required |
| `stt` / `embed` slot config | PRD-002c | Required |
| BullMQ + Valkey | PRD-001a scaffold | Required |
| Cloudflare Stream + Deepgram + Vimeo credentials | platform env | Required |
| `library_documents` / `library_chunks` | this sub-PRD | Created here |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Max upload size / duration caps per tenant tier? | Cost control feeds the wallet story; long media = large Deepgram spend | Interim: platform-wide caps (500MB / 4h) as config values; per-tier caps deferred to PRD-007 pricing work |
| Q-2 | Does Vimeo remain a supported source for non-EL-OS coaches? | Carried from EL-OS; may be dead weight | Decided: keep — it is already ported code and exercises the no-transcription path |
