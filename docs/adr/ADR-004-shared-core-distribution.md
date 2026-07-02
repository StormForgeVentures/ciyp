# ADR-004 — Shared-core package distribution across the two repos

**Date:** 2026-06-18 · **Status:** Accepted · **Decision owner:** Software Architect

## Context

CIYP is **two repos** (locked decision #1): `ciyp-platform` (engine) and `ciyp-template` (member UI). They
share code, but asymmetrically:

- The **member UI** needs only **`@ciyp/shared`** (types + zod schemas for the 6 contracts) and
  **`@ciyp/ui-tokens`** (design tokens). It must **never** import `agents` or `prompts` — it runs zero AI,
  and pulling the brain into the client would defeat the thin-client design and leak prompts/IP onto devices.
- The **engine** needs the **full** internal packages: `agents`, `prompts`, `shared`, `ui-tokens`.

The hard requirement: the **wire shape cannot drift** between engine and UI. Contract 02's `parts`
discriminated union, contract 01's Instance Config, etc. must be the *same* TypeScript types on both sides,
and the UI must be able to **pin a known-good contract version** (it ships on its own cadence and can't be
broken by an engine-side contract change landing mid-flight).

The two repos are **not co-located in a single pnpm workspace** (separate repos, separate release cadences,
MVP vs production stages).

## Decision

**Publish `@ciyp/shared` and `@ciyp/ui-tokens` as versioned packages to a private npm registry; both repos
consume pinned versions. `agents` and `prompts` stay internal to `ciyp-platform` (workspace-internal, never
published).**

- Inside `ciyp-platform`, all four packages are **pnpm workspace** members (`packages/*`); the engine
  consumes them via `workspace:*`. `agents`/`prompts` never leave the workspace.
- `@ciyp/shared` and `@ciyp/ui-tokens` are additionally **built and published** to a private registry
  (e.g. GitHub Packages / npm private scope) on a version bump.
- `ciyp-template` adds them as **pinned dependencies** (`"@ciyp/shared": "1.4.0"`), not a range, so a UI
  build is reproducible and immune to surprise contract changes.
- `@ciyp/shared` is the **single source of truth** for the 6 cross-repo contracts: the zod schemas live
  there; TS types are inferred from them; the engine validates against the same schemas it publishes.

## Consequences

**Positive.**
- **No drift:** both repos consume the *same* compiled types from one published artifact. A contract change
  is one version bump.
- **UI pins a known-good version** and upgrades deliberately — engine contract work can't break a UI build.
- **IP/brain stays server-side:** `agents`/`prompts` are physically unpublishable to the client; the
  thin-client guarantee is structural, not a code-review hope.
- Standard tooling (npm semver, lockfiles, `npm audit`) — no exotic submodule/subtree workflow.

**Negative / accepted.**
- **Two-step releases:** a contract change = publish `@ciyp/shared`, then bump the UI dep. Slight ceremony.
  Accepted; it's the price of pinning and the reason drift can't happen.
- **Private registry to operate** (auth, CI publish step). Accepted; low overhead, standard.
- Version skew is *possible* if the UI lags far behind — mitigated by additive-only contract evolution
  (deprecate, don't break; see constraint).

## Alternatives rejected

- **Single pnpm workspace spanning both repos.** Cleanest DX *if* co-located. Rejected: the repos are
  separate (different stages/cadences, locked decision #1) and a shared workspace would couple their release
  cycles and risk pulling `agents` toward the client.
- **git submodule / subtree for `shared`.** Rejected: brittle DX, no semver pinning semantics, easy to get
  the UI on an unintended commit; `npm audit`/lockfile story is worse.
- **Copy-paste types into each repo.** Rejected: drift by construction — exactly the failure mode we must prevent.
- **Publish `agents`/`prompts` too (one big SDK).** Rejected: risks the brain/prompts reaching the client;
  breaks the thin-client and IP-containment guarantees.

## Constraint for downstream

- The member UI imports **only** `@ciyp/shared` + `@ciyp/ui-tokens`. Importing `agents`/`prompts` in the UI
  is a must-fix.
- Contract changes are **additive / deprecate-don't-break**; a breaking change is a major version bump +
  a coordinated UI upgrade + a `handoff/project-state.md` entry.
- The UI pins **exact** versions of the shared packages (no ranges).
- `@ciyp/shared` is the canonical home of the 6 contract schemas; nothing redefines a contract type locally.
