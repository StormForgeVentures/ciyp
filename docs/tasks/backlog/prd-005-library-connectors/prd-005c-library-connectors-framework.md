# PRD-005c: Connector Framework

> Parent: prd-005-library-connectors-index.md | Module: Library & Connectors

## Goal

The per-tenant integration substrate (architecture §9, verbatim as requirements): `tenant_integrations` rows as the source of truth, an OAuth 2.1 envelope-encrypted token vault, and per-scope registration into the Sport MCP catalog — plus the connections UI. Provider-agnostic by design: 005d's Granola/Fathom are its first consumers, and adding a provider later must not touch this framework's core. Lifts ScalingCFO's proven QBO vault pattern; sport-ai-sdk **#29** generalizes that vault into `sport-server` — the platform implements it behind a connector port so the SDK kit slots in without rework, and **#25** (per-scope assembly manager) is what makes per-tenant catalogs viable on a shared host. Cite issues, never SDK versions.

## Functional requirements

1. `tenant_integrations` rows carry provider, connection state, config, and a token-vault reference; per tenant scope, active rows register into the Sport MCP catalog (`connectMcpCatalog` → `listActive(scope)` → governed, namespaced `mcp:{server}:{tool}` tools). **No connector ever resolves under a sentinel/global scope.**
2. Connection state machine: `consent_pending → connected → revoked`, plus `needs_consent` when a refresh fails irrecoverably; every transition is persisted and auditable.
3. The token vault stores access + refresh tokens **envelope-encrypted at rest** (platform-held key via env reference); a token refresh **rotates the stored pair atomically** (rotation-aware write — a concurrent reader never sees a torn pair).
4. OAuth 2.1 lifecycle per provider: authorize-URL issuance (with state + PKCE), public callback exchange, background refresh ahead of expiry; refresh failures transition state and surface in connector health.
5. Credentials never enter `ResolvedScope`, `ai_traces`, logs, or any API response (ADR-006 rule 5); the ScopeResolver lint rule from PRD-002b covers this path too.
6. Enabling/disabling an integration invalidates the tenant's assembly scope so the catalog change takes effect without redeploy (the PRD-002b invalidation seam).
7. Connections UI in `apps/web`: provider cards with state, connect (launches consent), disconnect (revokes + tombstones tokens), and health (last refresh, last successful call).
8. Cross-tenant isolation and token confidentiality are tested, not asserted: the ScalingCFO test pattern (encrypted token columns never serialized to clients; tenant A cannot read/trigger tenant B's integration).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a tenant admin clicking Connect on a provider card, when the OAuth consent completes at the callback, then a `tenant_integrations` row is `connected` and its tokens exist only envelope-encrypted in the vault table. |
| AC-2 | Given any API response or trace row produced during connect/refresh/import, when inspected in tests, then no access/refresh token plaintext or encrypted blob appears in it (`refresh_token_enc`-style columns never serialized to clients). |
| AC-3 | Given a connected integration for tenant A, when tenant B's admin requests A's integration by id, then the response is 404 under RLS (isolation integration test). |
| AC-4 | Given an expired access token, when the importer next needs it, then the refresh rotates both tokens atomically and the original refresh token no longer decrypts to a usable value. |
| AC-5 | Given a provider refresh that fails with an auth error, when retries are exhausted, then the integration state is `needs_consent` and the provider card shows a re-consent action. |
| AC-6 | Given an integration toggled off, when the tenant's next AI turn assembles, then the provider's `mcp:{server}:*` tools are absent from that scope's catalog (assembly-invalidation test). |
| AC-7 | Given the MCP catalog resolving for a scope, when `listActive` is called, then it receives the real tenant scope — a sentinel/global scope value fails the test. |

## Data requirements

| Entity | Field | Type | Notes |
|---|---|---|---|
| `tenant_integrations` | `id` | uuid pk | schema stub created in PRD-001b; constrained here |
| | `tenant_id` | uuid FK, indexed | RLS |
| | `provider` | text (`granola \| fathom \| …`) | provider registry key; unique `(tenant_id, provider)` |
| | `state` | enum `consent_pending \| connected \| needs_consent \| revoked` | platform enum |
| | `config` | jsonb | provider-specific, non-secret (e.g. folder selection defaults) |
| | `vault_ref` | uuid FK nullable | → `integration_tokens` |
| | `last_refresh_at` / `last_success_at` | timestamptz | health |
| `integration_tokens` | `id` | uuid pk | the vault |
| | `tenant_id` | uuid, indexed | RLS; belt-and-suspenders with join |
| | `access_token_enc` / `refresh_token_enc` | bytea | envelope-encrypted; **never selected by client-facing queries** |
| | `key_id` | text | envelope key version (rotation of the platform key) |
| | `expires_at` | timestamptz | drives proactive refresh |
| | `rotated_at` | timestamptz | atomic-rotation audit |
| `oauth_pending` | `state_token` pk, `tenant_id`, `provider`, `pkce_verifier_enc`, `created_at` | | consent/pending store; TTL-cleaned |

## Endpoints

| Method/Path | Auth | Purpose |
|---|---|---|
| `GET /admin/integrations` | tenant admin | provider cards: state + health |
| `POST /admin/integrations/:provider/connect` | tenant admin | create `oauth_pending`, return authorize URL (state + PKCE) |
| `GET /oauth/callback/:provider` | **public** (state-token validated) | code exchange → vault write → `connected`; idempotent on replayed state |
| `POST /admin/integrations/:provider/disconnect` | tenant admin | revoke at provider (best-effort), tombstone tokens, state `revoked` |

Internal: refresh scheduler (worker) — proactive refresh at `expires_at - margin`; never in a request path that could block a turn.

## UI/UX

Integrations screen (apps/web, admin nav):

```
┌──────────────────────────────────────────────────────┐
│ Integrations                                         │
├──────────────────────────────────────────────────────┤
│ ┌ Granola ────────────────┐ ┌ Fathom ─────────────┐ │
│ │ ● Connected             │ │ ○ Not connected      │ │
│ │ Last sync: Jul 1, 09:12 │ │                      │ │
│ │ [Import meetings]       │ │ [Connect]            │ │
│ │ [Disconnect]            │ │                      │ │
│ └─────────────────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

Key behaviors: Connect opens the provider consent in a new window and the card resolves on callback (poll `oauth_pending` → state); `needs_consent` renders a warning variant with Re-connect; Import meetings routes to 005d's selection flow.

## Hybrid Interface

Config-type hybrid seam, scoped: the UI writes `tenant_integrations` (state/config); the AI runtime reads it at assembly time via `listActive(scope)`. Write→read consistency is the assembly invalidation (FR-6, AC-6) rather than a PromptVersion record — integration toggles change *tool availability*, not prompt content; the toggle is itself audited (state transitions persisted, actor recorded). Token tables are excluded from the shared shape by design: the AI side receives live tool transports, never token material.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenant_integrations` schema stub | PRD-001b | Modified here (constraints + vault tables) |
| Per-scope assembly + invalidation + `mcp-catalog.ts` seam | PRD-002b | Required |
| Admin app shell, roles | PRD-006a | Required |
| Platform envelope-encryption key (env) | Luminify operator | Required |
| sport-ai-sdk #29 (vault kit), #25 (per-scope assembly) | sport-ai-sdk | Interim platform implementation behind the connector port; kit replaces glue when the issues resolve |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Provider apps/keys: platform-level OAuth apps (one Granola app for all tenants) or per-tenant apps? | Consent UX, quota pooling, provider ToS | Interim: platform-level apps (matches ScalingCFO QBO month-1); per-tenant is a provider-driven escalation |
| Q-2 | Token vault key rotation cadence? | `key_id` exists; rotation runbook doesn't | Deferred to the security wave: runbook task, re-encrypt lazily on next write |
