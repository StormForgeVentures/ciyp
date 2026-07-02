# Project State — append-only decisions log

> Updated at wave boundaries by the PM (or orchestrator). Every agent reads this at startup
> instead of replaying upstream artifacts. Binding decisions only — keep each entry ≤ 3 lines.
> Never delete entries; supersede them ("supersedes #N").

## Current constraints (live summary — PM maintains, ≤ 20 lines)

- **PIPELINE:** discovery ✓ · ai-design ✓ · architecture ✓ · prd ✓ · generate-tasks ✓ · waves ✓ · **plan gate ✓ (Tim, 2026-07-02 — "we are a go")** · **BUILD ← ACTIVE** · acceptance ☐
- **NEXT (resume here):** build-run **wave 0** (prd-001 §1.0–2.0, contract freeze — folder promoted to `in-work/`), then wave 1 per `handoff/wave-plan.md`. `design-app` runs for the UI surfaces (apps/web screens: PRD-005b/006/007a) before their build waves — design gate with Tim precedes wave-2 UI work.
- PRD output: 9 PRD folders (34 spec docs; PRD-009 = index-locked backlog module) + 8 task lists + `handoff/acceptance-ledger.md` (230 AC rows, all OPEN) + `handoff/reuse-map.md` (donor-code map). All plan-gate decisions resolved (#13–#15); ADR-008 fixes the money topology (coach-Stripe connector, GHL-style).
- ai-design outputs: `docs/ai-architecture/feature-classification.md` (18 features: 2 AI-native · 9 Hybrid · 7 Traditional) + `docs/ai-architecture/ai-architecture.md` (slots) + ADR-006 (Sport runtime) + ADR-007 (EL-OS inheritances, closes OQ-1). Orientation input: `handoff/sport-sdk-orientation.md`.
- Discovery output: `docs/project-brief.md` (canonical system brief). Architecture: `docs/architecture.md` + `docs/adr/` (7) + `docs/contracts/` (6).
- Sibling repo `ciyp-template` = thin member UI (MVP); blocked until the 6 contracts are frozen here.
- SDK dependency discipline: cite sport-ai-sdk issue numbers (#25–#27 critical path for coach-authored agents; #28–#31 mid-build), NEVER a version pin (Tim 2026-07-02).
- Open for Tim: OQ-2 only (Luminify archetypes/tiers content — provisioning input; seed uses placeholders). OQ-3 resolved: markup default 1.1× (decision #13).

## Decisions log

| # | Date | Wave | Role | Decision (binding for downstream) |
|---|------|------|------|-----------------------------------|
| 1 | 2026-06-18 | discovery | PM | Two repos, engine-first: `ciyp-platform` (engine+platform, production) built before `ciyp-template` (thin member UI, MVP). |
| 2 | 2026-06-18 | discovery | PM | Tenancy = shared multi-tenant now, promotable to dedicated per-coach engine+DB later (ADR-001). Coach = tenant. |
| 3 | 2026-06-18 | discovery | PM | Three money flows: member→coach (Stripe web checkout, no IAP); coach→Luminify (prepaid AI wallet, metered, hard enforcement in v1); coach absorbs members' AI cost. |
| 4 | 2026-06-18 | discovery | PM | Seed coach = Luminify (Tim's own coaching business). Instance-agnostic: no Kyle content in either repo. |
| 5 | 2026-06-18 | discovery | PM | Voice = P0 (native-first). De-enum surface = archetype/tier/coaching-method → per-tenant config. |
| 6 | 2026-06-18 | architecture | software-architect | Architecture drafted (extraction of EL-OS). NOTE: produced before ai-design — AI-stack/model-slots must be ratified by the AI-architect in the ai-design phase. |
| 7 | 2026-07-02 | ai-design | ai-architect | Sport AI SDK is the agent runtime (ADR-006). Pure brain stays pure; per-scope assembly + live slot config mandatory (ScalingCFO anti-patterns prohibited). SDK↔platform boundary per `handoff/sport-sdk-orientation.md` §6; gaps ship as SDK issues. |
| 8 | 2026-07-02 | ai-design | ai-architect | AI stack ratified: Sport slot taxonomy stored per-tenant (`app_config.model_routing`), OpenRouter gateway, Claude-family default/fast, Voyage embed+rerank, Deepgram streaming STT, Fish-audio per-tenant TTS (ADR-007, closes OQ-1). Paid Voyage key = build prerequisite. |
| 9 | 2026-07-02 | ai-design | ai-architect | Feature lanes locked (`docs/ai-architecture/feature-classification.md`): 2 AI-native, 9 Hybrid, 7 Traditional. Coach-authored agent studio = Hybrid core surface; depends on sport-ai-sdk issues #25–#27 (cite issues, never versions). Off-table model metering priced by platform pricebook, not SDK derivedCost (OQ-A → metering PRD). |
| 10 | 2026-07-02 | ai-design | Tim | Granola/Fathom meeting-recording import = **P0** in v1 (supersedes brief's P1). Connector layer (per-tenant MCP catalog + OAuth vault) enters v1 scope; reuses library ingestion pipeline. |
| 11 | 2026-07-02 | ai-design | Tim | `apps/web` = coach/admin only (centralized). Member web/desktop = the template's **PWA** (responsive incl. desktop), per-client optional — no member area in apps/web, no extra member surface. |
| 12 | 2026-07-02 | prd | PM | v1 speced as 8 PRD folders (foundation · sport-runtime · coaching-surfaces · voice · library+connectors · admin+studio · ai-economy · store+provisioning), 229 ledgered ACs, 6-wave plan. Ledger-side pricebook pricing (contract 03 unchanged) proposed pending plan-gate ratification. 5 open decisions parked as wave-plan checkboxes for Tim. |
| 13 | 2026-07-02 | plan gate | Tim | Pricing resolved: pricebook ratified (default rate rule + per-model overrides; per-tenant markup, default **1.1×**); voice cut = finish in-flight reply then close (balance may go bounded-negative); auto top-up confirmed (= 007a auto-recharge); storage costs excluded from usage billing (tenant subscription/maintenance). |
| 14 | 2026-07-02 | plan gate | Tim | Store: subscription = built-in default; flat-fee/free grants supported; **external enrollment API added (008a FR-9 / AC-22)** for GHL-style workflows. **Coach→member token-cost passthrough PARKED as post-v1 PRD** (contradicts v1 "members never see credits"; schema must not preclude — rates are stacked config). Remaining ledger total: 230 ACs. |
| 15 | 2026-07-02 | plan gate | Tim | **ADR-008 money topology (supersedes the parking in #14, refines #3):** member payments settle on the COACH's own Stripe — platform never holds coach/member money; only flow (b) touches our account. **Mechanism: GHL-style direct integration (coach supplies a restricted API key; we create products/webhooks on their account) via the 005c connector vault — Stripe Connect considered and NOT chosen for v1** (swappable behind the connector port). Member credit billing = per-tenant `member_billing_mode` (`absorbed` default \| `member_credits`), coach's choice, baked in now: v1 builds the coach-Stripe connector + mode switch + non-preclusion; **PRD-009** (backlog) builds the member-credits economy. 001b/008a/008b updated. |
| 16 | 2026-07-02 | plan gate | Tim | **PLAN GATE APPROVED** ("Seems like we are a go"). Build begins at wave 0 (prd-001). Repo git-initialized with the approved plan as the baseline commit. |
