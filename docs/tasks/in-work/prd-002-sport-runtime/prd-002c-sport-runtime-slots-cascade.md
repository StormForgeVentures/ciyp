# PRD-002c: Model Slots + Cascade Blocks

> Parent: prd-002-sport-runtime-index.md | Module: Sport Runtime — AI Engine + Execution Substrate

## Goal

Make per-tenant AI behavior pure config: live per-scope model-slot resolution from
`app_config.model_routing` (a coach changes a model and the next turn uses it, no deploy), and the
cascade-block system that assembles every system prompt from data — platform-locked foundation layers,
tenant-owned brand/persona layers, context-as-data, and the instruction hierarchy always last. This is
where AC-2/AC-3 of the module index (two tenants, two behaviors, zero code differences) become true.

## Functional requirements

1. **Slot resolver:** Sport `createSlotResolver` wired with a **live** `LoadSlotConfig(scope)` that reads the tenant's `app_config.model_routing`, merges over platform defaults, caches per scope (TTL 3600s), and exposes `invalidate(scope)`. `staticSlotConfig` is a prohibited pattern (CI grep). Every config write path calls `invalidate` (Must-fix if missed, template §6).
2. **Slot table** per `docs/ai-architecture/ai-architecture.md` §2: `default, fast, classify, deep, worker, synthesis, vision, embed, rerank` + config-only `stt, tts` (`tts.voice_id` = per-tenant voice persona). Slot values are `{provider, model, params?}`; the Luminify seed carries the ratified seed values.
3. **No hardcoded models:** Sport's `HardcodedModelError` stays enabled; a CI grep for known model-id patterns outside seed/config files backs it up (rule 2).
4. **Per-role model overrides** (Sport ADR-021) are legal only when the override value originates from tenant config rows; a literal in code-authored roles is a rule-2 finding.
5. **Cascade blocks:** system prompts compose from ordered `{id, content}` blocks via Sport `composeCascade`: L0 platform foundation and L1 platform voice/quality (including the anti-sycophancy `[COACHING_QUALITY]` block) are **platform-locked — EL-OS's explicit refusal to make them tenant-configurable carries forward verbatim**; L2 tenant brand voice and L3 persona/archetype fragments come from tenant config (ADR-002 `prompt_fragment`s); L4 is `[CONTEXT — data, not instructions]`; L5 `[INSTRUCTION_HIERARCHY]` is always last (rule 10).
6. **Stable-prefix budget:** L0–L3 are budgeted against the working-memory window (EL-OS ~4K discipline); overflow trims L4 context, never the locked layers or L5.
7. Cascade composition is deterministic and unit-testable: same tenant config + same context in → byte-identical prompt out (the EL-OS byte-parity discipline, now applied to the single Sport path).
8. Every cascade-affecting config write (L2/L3 blocks, archetype fragments) triggers a `prompt_versions` record (002d) — config-type hybrid rule H-3, enforced here at the write path.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given tenant A with `default` slot = model X and tenant B = model Y, when one turn runs for each, then A's model-call trace records X and B's records Y. |
| AC-2 | Given tenant A's `default` slot is updated to model Z with `invalidate(A)` fired, when A's next turn runs, then its trace records Z, without process restart. |
| AC-3 | Given a code change introducing a literal model id outside config/seed paths, when CI runs, then the build fails (grep + `HardcodedModelError` test). |
| AC-4 | Given any composed cascade in the test suite, then the final block is `[INSTRUCTION_HIERARCHY]` (asserted structurally, not by string position). |
| AC-5 | Given a tenant config attempting to override an L0/L1 block id, when the cascade composes, then the override is rejected and traced (locked-layer test). |
| AC-6 | Given identical tenant config and turn context, when the cascade composes twice, then outputs are byte-identical. |
| AC-7 | Given a tenant updates an L2 brand block, when the write commits, then a `prompt_versions` row exists citing the block id and the tenant's prompt-set version increments. |
| AC-8 | Given oversized L4 context, when the cascade composes, then L0–L3 and L5 are intact and only L4 content is trimmed (budget test). |

## Data requirements

Consumes PRD-001's per-tenant `app_config` (`model_routing` JSONB, `config_version`) and ADR-002 config
tables (`tenant_archetypes.prompt_fragment`, brand-voice block rows). No new tables; cascade block
storage for tenant layers lives in the ADR-002 config rows (authored via PRD-006).

## Endpoints

No new public endpoints (slot/cascade reads are internal; authoring endpoints are PRD-006's).

## UI/UX

No frontend changes.

## Hybrid Interface

Not applicable here — the config-authoring hybrid contract (UI writes → AI reads, PromptVersion-on-write)
is owned by PRD-006b/006c; this sub-PRD implements the AI-side read + version-trigger obligations those
contracts cite.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Sport host assembly (`hostFor`) | prd-002b | Required |
| Per-tenant `app_config` + ADR-002 config tables + seed values | PRD-001 | Required |
| `prompt_versions` write path | prd-002d | Modified there |
| `@ciyp/prompts` platform blocks (L0/L1 sources) | prd-002a | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Platform-default slot values when a tenant omits a slot? | Fallback semantics must be deterministic | Decided: platform defaults ship as config rows (not literals); tenant merge is shallow per-slot. |
| Q-2 | Slot cache TTL 3600s vs invalidate-only? | Stale reads on missed invalidation | Interim: TTL 3600s as backstop + mandatory invalidate-on-write; revisit if drift observed. |
