# PRD-005: Library & Connectors

> Source: docs/project-brief.md + docs/architecture.md (§4.4, §9, §11) | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

This module turns a coach's body of work into the AI's grounded knowledge: an ingestion pipeline that chunks and embeds uploaded content, a management surface to run it, and the P0 connector layer (project-state decision #10) that imports Granola and Fathom meeting transcripts into the same pipeline. It addresses three distinct concerns: (1) getting content in — uploads, media transcription, Vimeo references, and connector imports; (2) making it retrievable — tenant-fenced, two-stage RAG per the ratified stack; (3) keeping the coach in control — status visibility, provenance, and connection management. It unblocks grounded chat citations (PRD-003a) and the provisioning seed's "realistic corpus" requirement (PRD-001c).

### Scope

| In scope | Out of scope |
|----------|--------------|
| Staged ingestion worker (resumable per stage) | Semantic/token-aware chunking (canon default only; eval-gated change later) |
| PDF, uploaded audio/video (Cloudflare Stream → Deepgram), Vimeo reference sources | Coach-authored tool logic on connectors (MCP or platform code only — ADR-006) |
| Library management UI in `apps/web` (upload, status, list, delete) | Member-facing library browsing UI (template repo concern, P1) |
| Per-tenant connector framework: `tenant_integrations` → Sport MCP catalog | Additional providers beyond Granola/Fathom (framework supports them; not built in v1) |
| OAuth 2.1 envelope-encrypted token vault (consent/pending/connected/revoked) | Self-serve provider onboarding (each provider files consent-scope + rotation semantics) |
| Granola + Fathom import flows with provenance + idempotent re-import | Real-time/webhook-push import (v1 is poll/list + explicit import) |
| Delete-then-re-index on document update (H-3) | Cross-tenant/global content sharing of any kind |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 005a | `prd-005a-library-connectors-ingestion-pipeline.md` | Staged worker: extract → transcribe → chunk → embed → index, tenant-fenced, resumable |
| 005b | `prd-005b-library-connectors-management-ui.md` | Coach-facing library UI + the knowledge-type Hybrid Interface over `library_documents` |
| 005c | `prd-005c-library-connectors-framework.md` | Connector framework: `tenant_integrations`, OAuth token vault, per-scope MCP catalog, connections UI |
| 005d | `prd-005d-library-connectors-granola-fathom.md` | Granola + Fathom providers on the framework: list → select → import → pipeline with provenance |

## Personas

- **Coach** — owns the tenant's body of work; uploads content, connects Granola/Fathom, decides which meetings become library material.
- **Coach's team admin** — runs day-to-day ingestion (uploads, status checks, deletes) under the coach's tenant with an admin role.
- **Luminify operator** — provisions the seed corpus (PRD-001c step 3), monitors connector health across tenants, holds the platform encryption key.
- **Developer agents** — build against the shared `library_documents` contract and the connector port; consume the eval signals.

## Module-level acceptance criteria

The criteria that span the whole module (cross-cutting / integration-level). Sub-feature criteria live in their sub-PRD, not here.

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the Luminify seed tenant and a logged-in coach admin, when they upload a PDF via the library UI, then a `library_documents` row advances through the stage statuses to `indexed` and its chunks are retrievable by the two-stage RAG path. |
| AC-2 | Given an indexed seed-corpus document, when a seeded member asks a chat question answered by that document, then the turn's response includes a `library_citation` part referencing that document. |
| AC-3 | Given a tenant with a connected Granola integration (fixture-backed double in CI), when the coach imports a meeting, then the transcript lands as `indexed` chunks whose parent document has `source = 'granola'`. |
| AC-4 | Given two tenants each with indexed content, when tenant A's retrieval runs with any query, then zero chunks belonging to tenant B appear in the candidate set (deterministic rule-4 isolation test at the query layer, not the ranking layer). |
| AC-5 | Given any connector or ingestion failure, when the coach views the library UI, then the affected document shows a `failed` status with its failing stage — never a silent stall. |

## Core UX per Surface

- **`apps/web` (coach/admin)** — a "Library" section: content list (title, source badge, status, updated-at) with upload entry point and per-item detail/delete; an "Integrations" section: provider cards with connection state, connect/disconnect actions, and an import-selection flow for connected providers. Density: operational dashboard, list-first; polling-driven status without manual refresh.
- **Member surface (template repo)** — none in this module; members encounter the library only as chat citations (PRD-003a).

## Technical Considerations

Reference `docs/architecture.md` §4.4 (retrieval), §9 (connector layer), §4.1 (migration lock discipline); this module must not contradict them.

**Single pipeline, many sources.** Connectors are a new *source*, not a parallel pipeline (architecture §9.3). Every source path converges on the same `library_documents` row + staged worker; the only source-specific code is acquisition (fetch/transcribe). If a sub-task proposes a connector-specific chunk/embed path, that is drift — reject it.

**Tenant fencing is two-layer.** Collection scoping AND a `tenant_id` payload filter on every vector query (ten-enforcement rule 4). The isolation test in AC-4 exercises the filter directly.

**Ingestion resumability.** Each stage transition is a persisted status write; a crashed worker resumes from the last completed stage rather than restarting the document (EL-OS `library-ingest` pattern). Stage work must therefore be idempotent per stage.

### Security

All library and integration routes are tenant-scoped (RLS) and admin-role-gated within the tenant. OAuth tokens are envelope-encrypted at rest and never appear in `ResolvedScope`, traces, logs, or API responses (architecture §9 constraints). Upload handling validates content type and size before storage; Deepgram/Cloudflare/Vimeo credentials are platform-held env references, never tenant rows. Rate-limit connector list/import calls per tenant to protect provider quotas.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants`, RLS baseline, `tenant_integrations` (schema) | PRD-001b | Required |
| Luminify seed corpus expectations | PRD-001c | Required (this module makes the seed corpus real) |
| Voyage embedder/reranker + pgvector vector-store ports | PRD-002b | Required |
| Per-scope Sport assembly + MCP catalog seam (`mcp-catalog.ts`) | PRD-002b | Required |
| Live slot config (`embed`, `rerank`, `stt` slots) | PRD-002c | Required |
| `library_documents` / `library_chunks` tables | This module (005a/005b) | Created here |
| OAuth token vault + connector port | This module (005c) | Created here |
| sport-ai-sdk #25 (per-scope assembly manager), #29 (OAuth connector kit) | sport-ai-sdk | Required as issues, not versions — interim platform seams specified in 002b/005c |

## Non-Goals

- No member-facing library browsing or search UI in v1.
- No providers beyond Granola and Fathom in v1 (the framework is provider-parameterized; adding one is a new sub-PRD).
- No webhook/push-based import; v1 imports are coach-initiated.
- No coach-authored connector/tool logic — connector behavior is MCP or platform code only.
- No re-embedding/vendor-swap tooling (ADR-007 reversal path is a separate, triggered effort).

## Success Metrics

- Retrieval precision ≥ 0.7 (alert 0.4) on the tenant golden set, including imported-transcript content.
- Import fidelity: 100% of imported transcripts' content reachable in indexed chunks (deterministic eval).
- Connector health: token-refresh success rate ≥ 99% over a rolling 7 days per tenant.
- Zero cross-tenant retrieval findings across all QA/security audits.

## Implementation Priority

1. **005a ingestion pipeline** — everything else feeds it; the seed (PRD-001c) needs it to index the corpus.
2. **005b management UI** — makes 005a operable and verifiable on real data (no-mock convention).
3. **005c connector framework** — the vault + catalog seam; independent of 005b, can run parallel to it once 005a's document shape is frozen.
4. **005d Granola/Fathom providers** — last; pure consumers of 005a + 005c.

## Related

- Task list: `tasks-005-library-connectors.md` (this folder — generate-tasks output)
- QA report: `qa/qa-005-library-connectors.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-005-library-connectors-NN` rows)
