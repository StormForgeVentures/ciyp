# QA — PRD-002 Sport Runtime · Wave-1 boundary (Track A: engine port 002a §1.0)

> Reviewer: qa-reviewer · Date: 2026-07-02 · Branch `feature/engine-port` (worktree `/home/twolf/repos/ciyp-wt-engine-port`, HEAD 286d2a8)
> Method: independent re-run (typecheck/build/test, forced-uncached) + source audit of every self-flagged deviation + cross-track config-shape check against Track B's seed.
> **Verdict: merge-ready.** 0 Must-fix, 1 Should-fix (wave-2 hazard, not a wave-1 breakage), 3 Notes. A-S1 should be logged before wave-2 assembly.

---

## Independent verification

- `pnpm typecheck` + `pnpm build`: clean (8/8, 4/4).
- `pnpm test --force` (uncached): **228 tests pass** — `@ciyp/agents` 176 (14 files), `@ciyp/api` 1, `@ciyp/prompts` 33 (2 files), `@stormforgeventures/ciyp-shared` 18. Dev's "228 green" reconciles exactly.
- Purity gate (`dependency-lint`): "agents purity, prompts zero-deps, no @earendil-works imports" ✓.
- **AC-1** — `@ciyp/agents` deps = exactly `{@stormforgeventures/ciyp-shared, zod}`; `@ciyp/prompts` zero deps. ✓
- **AC-5** — coach-IP grep (`reconnector|stabilizer|…|kyle|rapid harmony|empowered leader`) over `packages/` + `apps/` (docs excluded): **exit 1, clean**. ✓
- No `.skip/.only/xit` anywhere; no test suppressed.

---

## Adversarial pass on the self-flagged deviations

- **OpenRouter caller deliberately not ported** — correct per purity posture. FR-1 caps deps at shared+zod; the LLM caller is injected via `AgentSubstrate`. The gateway belongs to the runtime (002b/002c), not the pure brain. dependency-lint enforces it. ✓
- **Cadence collapsed into ONE generic module (injected outputSchema/buildFallback)** — parity holds. `finalizeCadence` does emit → one repair retry → `buildFallback(draft)`, and **never fabricates a row** (buildFallback throws on insufficient draft; the route then does not render completion). Forced-finalize machinery (AC-8) is present and tested (cadence 18 tests); the turn-*limit trigger* correctly lives in the route (002b), not the pure package. `source: 'emit'|'repair'|'fallback'` is the row-provenance field — distinct from the process-runner's `source:'code'|'authored'` (AC-4), which is separately covered by process-runner tests (11). ✓
- **Classifier unknown-target fallback dropped for opaque strings** — correct under de-enum. Routing safety lives in the closed `action` enum (always resolves `respond`); `target` is now an opaque tenant-config string with no closed set to fall back from, validated downstream by the executor (graceful-empty if unresolved). AC-2 fully met: unparseable JSON, Zod failure, transport error, and unconfigured-slot each resolve the documented `respond` fallback and write a trace with `parse_failed`+cause; `classify` always resolves, never blocks. ✓
- **De-enummed tool/doc kinds** — `get_recent_coaching_outputs.agent_kind` and `read_member_doc.kind` are `z.string().min(1)` opaque; the 7-tool manifest (`TOOL_NAMES`) is closed and generic. ✓
- **apps/api health scaffold re-pointed to TOOL_NAMES/PROMPT_BASELINES** — builds + tests (health 1 test). It now imports `@ciyp/agents` (TOOL_NAMES), `@ciyp/prompts` (PROMPT_BASELINES), and shared (MessagePart.safeParse) — a legitimate integration smoke proving the ported brain + prompts load at the engine edge. See A-N3.

---

## Findings

### A-S1 — Should-fix — Engine `ModelSlot` mirror diverges from the ratified §2 slot taxonomy (wave-2 assembly hazard)
**What:** `packages/agents/src/substrate.ts:7` declares (as a documented "local mirror" of the Sport taxonomy):
```ts
export type ModelSlot = 'chat' | 'fast' | 'vision' | 'embedding' | 'rerank' | 'stt' | 'tts';   // 7 keys
```
The **ratified** taxonomy (ai-architecture §2, and the keys Track B actually seeds into `app_config.model_routing`) is **11 keys**: `default, fast, classify, deep, worker, synthesis, vision, embed, rerank, stt, tts`. Divergences:
- `chat` (mirror) ≠ **`default`** (taxonomy — "coaching chat turns, process execution").
- `embedding` (mirror) ≠ **`embed`** (taxonomy).
- Mirror is **missing** `classify`, `deep`, `worker`, `synthesis`.

**Concrete manifestation:** `cadence/index.ts` traces coaching turns with `modelSlot: 'chat'` (L75, L161) — a slot name that does not exist in any seeded `model_routing`.

**Wave-1 impact — none:** the engine only ever calls `getModelSlot('fast')` (classifier, language-signal, retention, no-shame) — `fast` exists in both maps. `'chat'` is used only as a **trace label**; the actual model is injected as a pre-resolved string (`chatModel`), so there is no runtime slot miss and typecheck passes (the mirror is internally consistent).

**Wave-2 impact — real:** when 002b/002c wires the live `getModelSlot`, a resolver typed on the canonical 11-slot union will not unify with the engine's 7-key mirror, and `ai_traces` will record `modelSlot='chat'` — a slot absent from the tenant's `model_routing`, breaking per-slot observability/eval slicing. This is the classic *contextual-mismatch* AI failure mode (plausible local names that don't match the frozen project convention).

**Fix (Developer, before wave-2 assembly):** reconcile the mirror to the canonical taxonomy — rename `chat`→`default`, `embedding`→`embed`, add `classify/deep/worker/synthesis`, and update cadence's `modelSlot` label to `'default'`. Best: define the canonical `ModelSlot` once in `@stormforgeventures/ciyp-shared` and have both the seed and the engine mirror reference that single frozen list so the two tracks cannot drift again.

---

### A-N1 — Note — `memberDocCues` shape-transform seam (documented, wave-2 wiring)
Track B seeds `engine_config.memberDocCues` as `{kind, pattern, flags}[]` (JSONB-safe); the engine consumes `MemberDocCue { kind, re: RegExp }` (`orchestrator/doc-reference.ts`). The wave-2 runtime must implement the `{pattern,flags}` → `new RegExp(pattern, flags)` adapter before injecting the cue list. Verified the seeded patterns are **byte-identical** to the engine's `DEFAULT_MEMBER_DOC_CUES` (plan / reflection / member_note) — redundant but harmless; the `kind` values are valid opaque `ReadMemberDocKind`. No blocker; called out so 002b/002c wires the adapter (and `lightnessWideningLeans: ['connector']` → `PlayfulnessOpts.lightnessWideningLeans`).

### A-N2 — Note — Turbo cache can display a stale "No test files found" for `@ciyp/prompts`
`pnpm test` (turbo, cached) replays a stale empty-log for the prompts package ("No test files found"). Forced (`--force`) shows **33 tests pass**. CI runs fresh so it is unaffected, and the dev's 228 count is accurate. Minor: do not trust a cached "no tests" line — verify with `--force`.

### A-N3 — Note — apps/api now build-depends on the engine packages
The health scaffold imports `@ciyp/agents` + `@ciyp/prompts` + shared. Good integration smoke; creates a build dependency `apps/api → engine packages` (both land in the same wave, so fine).

---

## Ledger rows independently VERIFIED-eligible (PM updates the ledger)
**002a:** AC-1 ✓, AC-2 ✓, AC-3 ✓ (linter order asserted, 11 tests), AC-4 ✓ (process-runner source-parity, 11 tests), AC-5 ✓ (coach-IP grep clean), AC-6 ✓ (Zod-reject-before-execute, tools 15 tests), AC-7 ✓ (graceful-empty on missing table, tools tests), AC-8 ✓ (forced-finalize machinery + cadence 18 tests; turn-limit trigger lives in route 002b).
All 228 tests pass on forced re-run; purity gate clean.

## Merge-readiness (Track A)
Forks from `d62d1d6`. Cross-branch file overlap with Track B = only `.claude/memory/{decisions,failures}.md` (append-only logs — trivial). No overlap on apps/api, ci.yml, migrations, or root package.json. **No Must-fix.** Merge-ready; log A-S1 for wave-2 reconciliation.
