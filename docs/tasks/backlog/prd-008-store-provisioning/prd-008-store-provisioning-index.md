# PRD-008: Program-Access Store & Instance Provisioning

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

This module covers the two Traditional-lane flows that put a coach's instance into members' hands: the
program-access store, where a buyer completes Stripe web checkout and receives an entitlement the member UI
and engine honor, and the provisioning runbook + script that stands a new coach tenant up green from an
intake document. Together they address three distinct concerns: (1) money flow (a) — member → coach — ends
in an entitlement row the platform enforces at session start; (2) a new tenant is created by a repeatable,
eval-gated script rather than by hand; (3) the same script becomes the foundation of the ADR-001 promotion
runbook later. Completing this module unblocks v1 success criteria 2, 4 (top-up path lives in PRD-007), and 5.

### Scope

| In scope | Out of scope |
|----------|--------------|
| Stripe web checkout for the single program-access SKU | Per-coach product marketplace (multiple SKUs) — v1 non-goal |
| Checkout webhook → entitlement issuance (idempotent) | Native IAP / Apple or Google billing — binding decision #3 |
| Entitlement read API (contract 05) + expiry/revocation | Postpaid/invoice billing of any kind |
| Session-start entitlement gate in the engine | Per-turn entitlement checks (wallet owns the hot path) |
| Provisioning script implementing runbook steps 1–6 | Self-serve coach onboarding flow (P2) |
| Per-coach intake document template | Tenant promotion to dedicated deploy (ADR-001 — designed, not built) |
| Provisioning dry-run / idempotent re-run mode | Coach-facing provisioning UI |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 008a | `prd-008a-store-provisioning-access-store.md` | Stripe checkout → entitlement issuance, read API, expiry, and the session-start gate |
| 008b | `prd-008b-store-provisioning-runbook.md` | The provisioning script + runbook (6 steps, eval-gated, dry-run-safe) + intake template |

## Personas

- **Buyer / Member** — purchases program access via web checkout; expects access to unlock immediately and
  to be told clearly when it lapses.
- **Coach** — the tenant whose program is being sold; sees entitlement state on their members in admin.
- **Luminify operator (Tim/team)** — runs the provisioning runbook to onboard a coach; superadmin; needs a
  repeatable, verifiable script, not tribal knowledge.
- **Developer agents** — build against this spec; consume the seed's expired-entitlement edge shape for tests.

## Module-level acceptance criteria

The criteria that span the whole module (cross-cutting / integration-level). Sub-feature criteria live in
their sub-PRD. These are the rows `generate-tasks` lifts into `handoff/acceptance-ledger.md` as
`AC-008-store-provisioning-NN`.

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a Stripe test-mode checkout completed for a seeded member, when the webhook is processed, then `GET /v1/entitlement` for that member returns `status: 'active'` with the purchased `tierKey`. |
| AC-2 | Given the Luminify seed's expired-entitlement member, when that member opens a chat thread or voice session, then the engine refuses at session start with the entitlement-expired state (distinct from `spend_denied`). |
| AC-3 | Given a clean database and a completed intake document, when the provisioning script runs for a new tenant, then all 6 runbook steps complete and the script exits green. |
| AC-4 | Given a freshly provisioned tenant, when the eval golden set runs against its config (runbook step 5), then all metrics meet their targets before the script reports go-live-ready. |
| AC-5 | Given a freshly provisioned tenant, when `GET` Instance Config (contract 01) is called for it, then the response validates against the `@ciyp/shared` schema and contains zero identifiers from any other tenant. |

## Core UX per Surface

- **Member (via ciyp-template, web checkout):** the Expo client opens Stripe web checkout in a browser
  surface (no IAP); on return, entitlement state refreshes and gated screens unlock. Entitlement-expired
  renders a renew prompt naming the coach; it never renders wallet/credit language (that state is
  `spend_denied`, PRD-007's contract).
- **Admin (`apps/web`):** member list shows entitlement status per member (read-only in this module);
  operator-facing provisioning is CLI/runbook, not a UI surface in v1.
- **Operator (CLI):** `provision` script run with an intake file; human-readable step-by-step output,
  per-step pass/fail, final go-live-ready verdict; `--dry-run` prints the plan without writes.

## Technical Considerations

**Entitlement is a projection, not a source of truth.** Stripe subscription state (via idempotent webhooks)
is authoritative; the entitlement read model is projected from stored subscription rows (contract 05
derivation). Rebuilding the projection from stored Stripe events must be possible — investigations and
webhook-outage recovery depend on it.

**Session-start-only enforcement.** The engine checks entitlement when a thread/voice session opens — never
per turn (architecture §7 flow a). Adding a per-turn check would put a read on the hot path the wallet seam
was explicitly designed to keep clear; QA should treat a per-turn entitlement read as a finding.

**Provisioning and promotion share a spine.** The script must be written as idempotent, resumable steps
against an injected DB handle — the ADR-001 promotion runbook reuses steps 1–6 against a *fresh* DB. No
step may assume "the shared DB" beyond what `TenantContext` provides.

### Security

- Webhooks: Stripe signature verification required; events deduplicated on Stripe event id; handler is
  additive/idempotent with revert-deploy as back-out (architecture §14).
- Entitlement API: member-session auth; tenant + member resolved from token, never from request params.
- Provisioning script: operator-only (service-role credentials, never shipped to web); intake files may
  contain coach PII — stored in the operator's ops location, not committed to the repo.
- Cross-tenant: a provisioned tenant's rows are created under its `tenant_id` only; AC-5 guards leakage.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants`, entitlement/subscription tables, `stripe_*` rows | PRD-001b schema | Required |
| Luminify seed (expired-entitlement member edge shape) | PRD-001c | Required |
| Library ingestion pipeline (runbook step 3) | PRD-005a | Required |
| Wallet creation + markup config (runbook step 4) | PRD-007a | Required |
| Eval golden-set runner (runbook step 5) | PRD-002d | Required |
| Instance Config emission (runbook step 6, contract 01) | PRD-006b | Required |
| Entitlement contract schema | `@ciyp/shared` (PRD-001a, contract 05) | Required |

## Non-Goals

- Per-coach product marketplace — v1 sells a single program-access SKU per tenant.
- Native IAP / Apple or Google billing — web checkout only (binding decision #3).
- Self-serve provisioning — v1 is a manual runbook; P2 wraps the script in onboarding.
- Tenant promotion to a dedicated deployment — ADR-001 designs it; nothing here builds it.
- Refunds/dunning UX beyond honoring Stripe status transitions in the entitlement projection.

## Success Metrics

- v1 success criterion 5: a buyer unlocks member access via Stripe web checkout and the entitlement is honored end-to-end.
- v1 success criterion 2: a new member instance stands up green from the provisioning runbook on the Luminify seed.
- Webhook-to-entitlement latency P95 < 30s (checkout completion → entitled read).
- Zero manual DB edits required to onboard a test tenant (everything via script + intake).

## Implementation Priority

1. **008a access store** — entitlement gating is on the engine's session-start path, so PRD-003/004 need
   its interface early; buildable once PRD-001 schema + contracts exist.
2. **008b provisioning runbook** — last-mile integrator; depends on nearly every other module (ingestion,
   wallet, evals, instance config), so it lands late in the wave plan and doubles as an integration test of
   the whole platform.

## Related

- Task list: `tasks-008-store-provisioning.md` (this folder — generate-tasks output)
- QA report: `qa/qa-008-store-provisioning.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-008-store-provisioning-NN` rows)
