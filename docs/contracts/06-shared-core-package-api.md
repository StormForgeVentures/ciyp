# Contract 06 — Shared-core package API

**Direction:** both repos · **Backing design:** ADR-004. · **Stability:** semver; contracts additive-only.

Defines the surface the two published packages expose. The member UI consumes **`@stormforgeventures/ciyp-shared`** (types)
and **`@stormforgeventures/ciyp-ui-tokens`** (design tokens); the engine consumes those **plus** the workspace-internal
`agents`/`prompts` (never published). This contract pins what crosses the repo boundary.

## `@stormforgeventures/ciyp-shared` — exported surface

```ts
// Contract schemas + inferred types (the SINGLE source of truth for the wire)
export {
  // 01 Instance Config
  InstanceConfig, Archetype, Tier, Journey, Branding, UiModelRouting,
  // 02 Coaching API
  MessagePart, TextPart, AudioPart, LibraryCitationPart, ProcessOfferPart, VoiceInputRefPart,
  ChatTurnRequest, ChatTurnEvent, CheckinStartRequest,
  VoiceSessionStartRequest, VoiceSessionStartResponse,
  // 03 Usage Event (engine-internal, but typed here for the ledger consumer)
  UsageEvent, UsageFeature,
  // 04 Spend Authorization (engine-internal)
  AuthorizeRequest, AuthorizeResponse, SettleRequest,
  // 05 Entitlement
  Entitlement,
} from './contracts';

// Shared generic enums (platform mechanics — ADR-002 "stay" list)
export {
  InteractionMode, CoachingModality, ChatThreadState, ChatMessageRole, /* … */
} from './enums';

// Type guards / helpers the UI needs to render parts safely
export { isTextPart, isAudioPart, /* … */ } from './guards';
```

- **What the UI uses:** all contract types + part guards + the generic enums it renders against. It does
  **not** import anything from `agents`/`prompts`.
- **What the engine uses:** the same schemas (to validate requests/responses against the exact shape it
  publishes) + the internal packages.

## `@stormforgeventures/ciyp-ui-tokens` — exported surface

```ts
export const tokens: {
  color: Record<string, string>;
  space: Record<string, string>;
  radius: Record<string, string>;
  type:  Record<string, string>;
  // … base design tokens; per-tenant overrides arrive via InstanceConfig.branding.themeTokens
};
export type Tokens = typeof tokens;
```

Base tokens ship in the package; **per-tenant branding overrides** layer on top via
`InstanceConfig.branding.themeTokens` (contract 01). The UI composes base ⊕ overrides.

## Versioning & consumption rules

| Consumer | Imports | Pinning |
|---|---|---|
| `ciyp-template` (UI) | `@stormforgeventures/ciyp-shared`, `@stormforgeventures/ciyp-ui-tokens` | **exact** versions (no ranges) |
| `ciyp-platform` (engine) | `@stormforgeventures/ciyp-shared`, `@stormforgeventures/ciyp-ui-tokens` (via `workspace:*`) + internal `agents`/`prompts` | workspace-internal |

## Constraints for downstream

- `@stormforgeventures/ciyp-shared` is the **only** definition of the 6 contracts. No repo redefines a contract type locally
  (drift-by-construction is the failure we prevent — ADR-004).
- The UI imports **only** `@stormforgeventures/ciyp-shared` + `@stormforgeventures/ciyp-ui-tokens`. Importing `agents`/`prompts` in the UI is a
  must-fix (thin-client + IP containment).
- Contract evolution is **additive / deprecate-don't-break**; a breaking change is a major bump + a
  coordinated UI upgrade + a `handoff/project-state.md` entry.
- The UI pins exact versions; engine and UI publishing is a two-step release (publish shared → bump UI dep).
