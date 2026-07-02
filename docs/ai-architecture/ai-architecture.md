# AI Architecture — ciyp-platform (model slots + runtime ratification)

**Generated:** 2026-07-02 (ai-design phase) · **Status:** v1, ratifies the provisional AI-stack picks in
`docs/architecture.md` §2.2 (made out of order by the software-architect — project-state decision #6).
**Companion docs:** `feature-classification.md` · ADR-006 (Sport runtime) · ADR-007 (EL-OS inheritances) ·
`handoff/sport-sdk-orientation.md`.

## 1. Ratification verdict

The architecture doc's stack table is **ratified with two structural changes and one recorded inheritance set**:

1. **The AI runtime is the Sport AI SDK** (`@theamazingwolf/sport-core` / `sport-server`) — ADR-006. The
   architecture doc's `agent-wiring.ts`/`cascade/` framing carries forward as the *pure-brain port layer*,
   but execution, slot resolution, tracing, memory/RAG ports, and orchestration run through Sport (as EL-OS
   already does, default-ON). SDK feature dependencies are expressed as **"issues #25–#27 resolved"** — never
   as a version pin (Tim, 2026-07-02).
2. **Slot taxonomy = the Sport SDK's**, stored per-tenant, resolved live per scope (§2). EL-OS's
   `chat/fast/…` keys map onto it at port time.
3. **EL-OS stack inheritances** (Voyage embed+rerank, Claude-family fast slot, Fish-audio TTS, streaming
   Deepgram STT) are ratified as recorded substitutions with flip-constraints — ADR-007 closes
   architecture OQ-1.

## 2. Model slots (rule 2: models live in config, not code)

**Storage:** per-tenant `app_config.model_routing` JSONB (one row per tenant, ADR-002 §3).
**Reader:** Sport `createSlotResolver(loadConfig)` with a **live per-scope `LoadSlotConfig`** —
tenant-override → platform-default merge, cache TTL 3600s, `invalidate(scope)` on every config write
(template §6 discipline). **Never** the boot-frozen `staticSlotConfig` wrapper (ScalingCFO lesson —
orientation §4). Hardcoded model ids are rejected structurally by the SDK (`HardcodedModelError`).

Seed values below are the **Luminify default tenant's config rows**, not code:

| Slot (Sport key) | Purpose (consumers) | Provider | Seed model | Notes |
|---|---|---|---|---|
| `default` | Coaching chat turns, process execution (#1–#4) | openrouter | Claude Sonnet current (`claude-sonnet-4.6` at seed time) | Canon match (frontier slot via gateway). |
| `fast` / `classify` | Supervisor classifier, routing, linter assists, eval judges | openrouter | Claude Haiku current | Canon lists provider-mini as named alternative; EL-OS eval baseline: routing ≥ 0.9 (ADR-007). |
| `deep` | Reasoning-tier: heavy synthesis, doc distillation, hard eval judges | openrouter | reasoning-tier Claude (per-tenant optional) | New slot (SDK taxonomy); per-feature overrides use this slot key, never a literal (template §8). |
| `worker` / `synthesis` | Batch summarization (L1 curation, compaction), multi-agent synthesis legs | openrouter | Claude Haiku/Sonnet per cost | SDK taxonomy; defaults may alias `fast`/`default` per tenant. |
| `vision` | Media/frame description in ingestion (#7) | openrouter | Claude vision-capable current | Canon match. |
| `embed` | Asymmetric embedding — **`input_type` set explicitly per call**: `document` at index, `query` at retrieval | voyage | `voyage-3-large` @ 1024-dim (seed) | Substitution vs canon (Cohere) — ADR-007. Wrong input type = Must-fix; EL-OS ports `embedForIndex`/`embedForQuery` enforce it. **Seed uses `voyage-3-large` (decision #20): index + query embedder MUST be the same model — cross-model vectors don't match. Provisioning re-embeds the real corpus and may pick `voyage-3.5`; both are 1024-dim so schema/HNSW are unaffected, but doc+query must move together.** |
| `rerank` | Two-stage retrieval second pass, K=20 → N=5 (rule 6) | voyage | `rerank-2.5` | Substitution vs canon — ADR-007. Fallback on rerank error = top-K-by-ANN (degradation, traced). |
| `stt` | Voice sessions (streaming) + media transcription (batch) | deepgram | `nova-3` | Canon match; **streaming** accepted as pre-existing EL-OS capability — ADR-007. |
| `tts` | Per-coach voice persona | fish-audio | per-tenant `voice_id` | Config-only slot; the voice clone id IS tenant config (ADR-002). Not in canon — ADR-007. |

Per-role model overrides (Sport ADR-021: a Role may carry `{provider, model}`) are permitted **only** when
the value itself comes from tenant config rows (coach-authored agents, feature #5) — a literal in a code-
authored Role is a rule-2 finding.

## 3. Supporting layers (canon table, ratified)

| Layer | Choice | Canon verdict |
|---|---|---|
| LLM gateway | OpenRouter | default — match. Keys held platform-side; per Sport built-in descriptor (off-table models trace cost via platform pricebook, see §5). |
| Vector DB | Supabase pgvector, HNSW; tenant-fenced (rule 4: payload `tenant_id` filter even with scoping) | default — match. Flip trigger stays >1M chunks/tenant or p95 > 200ms → `vector.ts` seam (architecture §4.4). |
| Working memory | Valkey (TTL ~2h) | default — match (EL-OS already runs Valkey/ioredis). |
| Session memory | Postgres chat/thread tables + `parts` union | default — match. |
| Long-term memory | `member_facts` embeddings in pgvector, tenant + member fenced | default — match; rule 8 tiers hold; rule 9 (40-turn compaction with lock) binds the port of EL-OS's working-window/compaction. |
| Observability | `ai_traces` (extended: `prompt_tokens`, `completion_tokens`, `provider`, `model`, `cost_micros`) — also the **metering substrate** (ADR-003) | default — match. Rules 1 & 3 structurally enforced by Sport (provider call unreachable untraced; classify legs traced). |
| Eval harness | Ported EL-OS `src/evals` (judge/golden/runner) + Sport's structural no-eval-no-ship on process registration | default — match; rule 7 binds every AI-native/Hybrid feature (signals listed per feature in `feature-classification.md`). |
| Chunking | Recursive ~500 chars / 20% overlap, title-prepended (EL-OS Vectara-default) | default — match. |

## 4. Coach-authored agents — runtime shape (feature #5; detail lands in `ai-feature-design`)

- **Definitions are per-tenant rows** hydrated into Sport primitives: Role rows → `defineRole` (pure data,
  `aiFixHint` errors surfaced in the authoring UI), process directives → `defineProcess`
  (EL-OS `source: 'code' | 'authored'` graduation seam — the `'authored'` read path gets built here),
  prompt/persona text → cascade blocks, model picks → slot config.
- **Tools:** coaches select from the platform's curated code-tool catalog (allowlist by name) and/or enable
  per-tenant **MCP integrations** (`tenant_integrations` → Sport MCP catalog). Coach-authored tool *logic*
  is out of scope by design (orientation §2) — new behavior arrives as platform code tools or MCP servers.
- **Activation:** save → version bump → standard eval pack must pass (no-eval-no-ship, structural) →
  per-scope assembly rebuild + `invalidate(scope)`. No deploy in the loop.
- **SDK dependency:** issues **#25 (per-scope assembly manager), #26 (registry upsert), #27 (config-store
  ports)** resolved. Until then, the platform-side interim is a per-tenant assembly cache keyed on config
  version — build behind the same seam so the SDK features slot in when they land.

## 5. Open items carried into PRD

- **OQ-A (metering for off-table models):** Sport traces honest zero-cost for models Pi has no price row
  for (e.g. via OpenRouter). The wallet cannot bill zeros — the platform's Usage Event pipeline must price
  token counts from a **platform pricebook** (per-model rates in config) rather than trusting
  `derivedCost` alone. Lands in the metering PRD (contract 03).
- **OQ-B — resolved 2026-07-02:** Granola/Fathom import is **P0** (Tim).
- **OQ-C — resolved 2026-07-02:** `apps/web` stays coach/admin-only (centralized); member web/desktop is
  the **template's PWA** (responsive, desktop-capable), per-client optional — no additional member surface
  ("trying not to create too many pieces" — Tim).
- Architecture OQ-2/OQ-3 (Luminify archetype content; markup default) remain provisioning/pricing inputs —
  unchanged.
