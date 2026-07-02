# PRD-006a: Admin App Shell

> Parent: prd-006-admin-config-studio-index.md | Module: Admin & Config Studio

## Goal

Stand up `apps/web` as the tenant-scoped coach/admin console (feature #11, Traditional): Supabase-Auth
sign-in, role-gated navigation, superadmin tenant management, and the operator's tenant switcher. This is
the security spine every other admin surface (006b, 006c, and the PRD-005/007 screens) mounts into —
nothing in the console is reachable without it.

## Functional requirements

1. Vite + React + TanStack (Router/Query) app shell with left-nav sections: Dashboard, Instance, Agent Studio, Library, Wallet, Settings, and (superadmin only) Tenants.
2. Supabase Auth email/password sign-in for coach/admin users; session establishes the tenant scope server-side (request-ALS pattern — the client never supplies `tenant_id`).
3. Role gates from the `admin_role` enum: `owner` (coach) sees all tenant sections; delegated roles see the subset the matrix below grants; unauthorized sections are absent from nav AND rejected at the API.
4. Superadmin (Luminify operator) tenant management: list tenants with status, create tenant (shell record only — full provisioning is PRD-008), suspend/reactivate tenant.
5. Tenant switcher (superadmin only): selecting a tenant establishes an impersonation-style scoped session; every action taken while switched is audit-logged with operator id + target tenant.
6. Suspended tenants: coach/admin sign-in is refused with an explicit "instance suspended" state; superadmin can still view.
7. Dashboard v1 is a placeholder shell rendering seed-backed tenant identity (name, branding accent) — proves live-DB binding, no analytics (P1).
8. Empty/error/loading states on every screen; the shell renders correctly for a brand-new tenant with no config authored yet (seed edge shape).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a coach admin of tenant A with a valid session, when they request any admin API route with tenant B identifiers, then the response is 403/404 and no tenant B row is returned. |
| AC-2 | Given a user with a delegated `admin_role` lacking config rights, when they open the console, then Instance and Agent Studio are absent from nav and their API routes return 403. |
| AC-3 | Given the superadmin, when they create a tenant from Tenants, then a `tenants` row exists and appears in the list with status `active`. |
| AC-4 | Given the superadmin switched into tenant A, when they save any change, then an audit row records operator id, tenant A, action, and timestamp. |
| AC-5 | Given a suspended tenant, when its coach signs in, then authentication succeeds but the console renders the suspended state and all write APIs return 403. |
| AC-6 | Given an unauthenticated request to any admin route, then the response is a redirect to sign-in (UI) or 401 (API). |

## Data requirements

- `tenants` (PRD-001b, read/write here): `status` (`active | suspended`) transitions owned by this sub-feature.
- `admin_users` / tenant-membership + `admin_role` (PRD-001b shapes): read here; invitations/team management is Settings-lite v1 (owner adds a member by email, assigns role).
- `admin_audit_log` (created here): `id uuid pk · tenant_id · actor_user_id · acting_as_superadmin bool · action text · entity text · entity_id · created_at` — indexed `(tenant_id, created_at)`. Written by every superadmin-switched mutation (and reused by 006b/006c write paths).

## Endpoints

- `GET /admin/me` — session + role + tenant context (drives nav gating).
- `GET/POST /admin/tenants` · `PATCH /admin/tenants/:id/status` — superadmin only.
- `POST /admin/tenants/:id/switch` — superadmin only; issues scoped context; audit-logged.
- `GET/POST/PATCH /admin/team` — owner only; member + role management.
- All admin routes: Supabase JWT required; tenant scope resolved server-side; `admin_role` checked per the authorization matrix.

## UI/UX

Console frame — what every other sub-PRD mounts into:

```
┌────────────────────────────────────────────────────────────┐
│ ◈ {Tenant name}            [Tenant switcher ▾]  [Operator] │
├──────────────┬─────────────────────────────────────────────┤
│ Dashboard    │                                             │
│ Instance     │            {routed section}                 │
│ Agent Studio │                                             │
│ Library      │   Pending activation tray (when non-empty)  │
│ Wallet       │   ┌───────────────────────────────────────┐ │
│ Settings     │   │ ⏳ eval running: "checkin-v3" …        │ │
│ Tenants ⚿    │   └───────────────────────────────────────┘ │
└──────────────┴─────────────────────────────────────────────┘
```

Key behaviors: nav items render only when the role grants them; the switcher (⚿ = superadmin-only) shows a persistent "acting in {tenant}" banner while switched; suspended tenants render a full-screen suspended state in place of the routed section.

## Hybrid Interface

Not applicable — Traditional lane (feature #11).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants`, membership + `admin_role` | PRD-001b | Required |
| Supabase Auth project config | PRD-001a scaffold | Required |
| Luminify seed (tenant + admin users to sign in as) | PRD-001c | Required |
| `admin_audit_log` | This sub-PRD | Created here |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Does tenant creation here seed a minimal `app_config` row, or is that provisioning-only (PRD-008)? | A tenant with no `app_config` breaks slot resolution if anything runs before provisioning | Interim: create-tenant writes a platform-default `app_config` row; PRD-008 overwrites at provisioning. |
| Q-2 | Delegated-role granularity for v1 (how many `admin_role` values)? | Over-modeling roles bloats the matrix; brief lists "admin team roles" as P1 | Decided: v1 ships `owner` + `member` (config-read-only); finer roles land with P1 feature #18. |
