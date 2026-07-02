# Design Brief — CIYP Coach/Admin Console (`apps/web`)

> Authored by the Designer for the design-app run (2026-07-02). Target Figma:
> `https://www.figma.com/design/BXlkljEYi55XOEa5DX5kjw/CIYP`. Language ported from the EL-OS
> "Rapid Harmony" donor, **stripped of all coach branding** — CIYP is the instance-agnostic
> multi-tenant platform. Per-tenant brand overlays later via `InstanceConfig.branding.themeTokens`
> (contract 01), so the base system is neutral + themeable.

## App overview

`apps/web` is the tenant-scoped coach/admin console — the security spine every admin surface mounts
into (PRD-006a). Coach-admin + Luminify-superadmin roles only; **no member surfaces** (decision #11).
Data-dense: tables (library, ledger, pricebook, tenants, agents), config editors, wallet screens.

## Design direction

- **Density: Compact** — data-heavy admin. Reconciles the ui-tokens size scale (xs12/sm14/md16/lg20/xl28)
  plus an added `2xl` (~34) page title and a `display` step for big stat numerals. Spacing: the
  package scale 4/8/12/16/24/32/48/64.
- **Tone: Neutral / Professional** — the base must carry no brand signal. Slate-led neutral ramp is the
  star; a single **themeable accent** (default indigo `#3b5bdb` from ui-tokens `accent.default`) does
  action/active/link duty. Radius subtle (6–8px on components; `radius.sm/md/lg/full` = 4/8/16/full).
  Shadows minimal (one soft card tier + dropdown/modal tiers).
- **Font: Inter** for both display and body (reliable in Figma, neutral). Hierarchy via weight/size,
  not a second family. `font.display` is a themeable slot — a tenant may swap in a serif.
- **Modes: Light (primary) + Dark.** Light content + dark neutral sidebar matches the donor idiom. The
  sidebar uses inverse/dark surface tokens in BOTH modes (structural, not brand).

## Structural idioms ported from the donor (utility surface — familiar patterns are legitimate)

- ~200px fixed dark sidebar: brand slot (top), nav items (active = subtle-fill pill + accent dot +
  accent text), user/tenant card (bottom). Superadmin adds a Tenants item (⚿) + tenant-switch banner.
- Light content: page header (title + muted subtitle + right-aligned actions) → content.
- 4-up stat card row; white bordered cards; status dots (positive/warning/danger/neutral);
  read-only ledger/list tables; tabbed config sections; centered empty states (icon + message + CTA).

## Color system — round-trips with `@stormforgeventures/ciyp-ui-tokens`

Semantic variable names map 1:1 to the package keys (the API): `bg.base/subtle/inverse`,
`text.primary/secondary/inverse`, `accent.default/subtle`, `positive/warning/danger.default`,
`border.default`. Two-layer: Primitives (slate + indigo + semantic hue ramps) → Semantic (Light/Dark).

### Proposed ui-tokens additions (needed by the system; keys are additive)

- `text.muted` (third text tier — timestamps/captions), `text.on-accent` (label on accent fill — never
  bind fill+text to the same token).
- `accent.hover`, `accent.pressed`, `border.focus`, `border.strong`.
- `bg.elevated` (card surface distinct from base, load-bearing in dark mode), `bg.overlay`
  (dropdown/menu/modal surface).
- `info.default` + subtle tints `positive.subtle` / `warning.subtle` / `danger.subtle` / `info.subtle`
  / `accent.subtle` for badges (soft fill + full-strength text).

## Surfaces (build-order, per the run brief)

1. Admin shell (006a) — auth, app frame/nav, tenant switcher, roles, audit log. **Full depth.**
2. Wallet / AI-economy (007a + 007c pricebook) — balance, ledger, top-up, auto-recharge, usage
   breakdown, pricebook admin. **Full depth.**
3. Library + connectors (005b/005c/005d) — corpus mgmt, ingestion states, connector vault. Composition.
4. Instance config authoring (006b) — slot/model routing, archetype/tier/journey, eval-gated publish.
   Composition.
5. Agent studio (006c) — agent builder, eval gate, activation. Composition.

## Source PRDs / contracts

PRD-006a/b/c, 007a/c, 005b/c/d, 001b/c; contracts 01 (instance-config), 03 (usage-event), 04
(spend-auth), 05 (entitlement), 06 (ui-tokens). Real seed flavor: Luminify AI-coaching (decision #18).
