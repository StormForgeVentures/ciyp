# Project Memory — Decisions

> Episodic memory for THIS project. Agents append; humans prune at wave boundaries.
> Write a decision here whenever an architecture/design choice is made.
> Tag entries `[generalizable]` + `(role: <your-role>)` if the lesson applies beyond this
> project — `cadre distill` extracts tagged entries for the cross-project skill library.

Format per entry:

### <decision title> (role: <role>) [generalizable]?
**Decision:** what was chosen
**Rationale:** why
**Alternatives rejected:** what else was considered and why not
**Date:** YYYY-MM-DD

---

## 2026-07-02 — wave-1 002a engine port (feature/engine-port)

De-enum + generalization decisions (all for the 002a EL-OS→CIYP brain port):
- Omitted EL-OS `llm/default.ts` (openRouterCaller/openRouterStreamer): it hardcodes the OpenRouter URL + does network. The pure brain must be provider-agnostic + network-free; real callers come from 002b/002c via the injected substrate. Kept only the LlmCaller/LlmStreamer TYPES (the seam).
- Classifier: `target` → opaque `z.string()`; `archetype_lean` → `z.array(z.string())`. Removed CLASSIFIER_TARGETS + ARCHETYPE_LEANS enums. Kept CLASSIFIER_ACTIONS + DETECTED_STATES (platform taxonomy, not coach IP). "unknown target → fallback" behavior dropped (targets are tenant config; orchestrator validates existence downstream).
- Tool manifest renamed generic (FR-7): get_recent_rww→get_recent_checkin_outputs, flag_for_red_review→flag_for_review. Event `red_handoff_triggered`→`review_handoff_triggered`. `get_recent_coaching_outputs.agent_kind` enum → opaque string. `read_member_doc.kind` → opaque string (dropped manifestation/eulogy enum).
- InteractionMode imported from @stormforgeventures/ciyp-shared (already a platform z.enum), not redefined locally.
- Coaching: CoachingAgentKind→string; CodeProcessDefinition.source widened to CoachingProcessSource ('code'|'authored') per FR-4/AC-4; ProcessGoal metric-threshold `metric:'sud'`→`metric:string`. Did NOT port the 4 Kyle processes (pmm/harmonizer/five_planes/eft_tapping).
- Cadence: EL-OS daily_checkin/weekly_checkpoint/monthly_rww depended on @elos/shared output schemas (Kyle IP, absent in CIYP shared). Generalized to a single generic cadence module: runCadenceTurn + finalizeCadence<T>(injected outputSchema+fallback) + buildCadenceDirective (injected role/intro/beats) + CADENCE_KINDS=['daily','weekly','monthly_review']. Kept computeJourneyPhase (generic). Dropped EMPOWER stage + nutrition/gratitude/RWW specifics + prepare.ts selector plumbing.
- run.ts orchestrator: dropped hardcoded TARGET_TO_AGENT_KIND/PROCESS_KINDS; offer part type decided by classifier ACTION (respond_and_offer_process→process_offer, _utility→utility_offer), agent_kind = opaque target string. Dropped dash→underscore mapping (EL-OS artifact).
- Voice linter: mechanic (archetype-name-leak vs injected registeredNames) is already generic; only scrubbed Kyle example names from comments. Playfulness "merlin-widening" → config param `lightnessWideningLeans: string[]`.
- prompts: ported machinery with EMPTY placeholder content (archetypeNames()=[], QUESTION_BANK/QUOTE_CORPUS=[] placeholder). Generic orchestrator persona + classifier prompt (no Pocket Kyle, no pmm/etc). Dropped day-of-arc (Kyle archetype matrix). Seed (PRD-001) backfills real content.
- All test fixtures de-Kyle'd (generic placeholder archetype names e.g. Sage/North Star) so the AC-5 coach-IP grep over packages/ stays clean.

---

### GUC-based two-layer RLS via installer helpers (role: developer) [generalizable]
**Decision:** For a backend-mediated multi-tenant control plane, enforce tenancy with GUCs (`app.tenant_id`/`app.member_id` read by `current_tenant_id()`/`current_member_id()`), not `auth.uid()`. Tenant fence = PERMISSIVE policy; member fence = RESTRICTIVE policy `(current_member_id() is null or member_col = current_member_id())` so it ANDs with the tenant fence and is a no-op in coach context. Installed via plpgsql helpers `enable_tenant_rls`/`enable_member_rls`/`grant_app_access` so 38 tables stay consistent.
**Rationale:** RESTRICTIVE is required for AND-composition (multiple PERMISSIVE policies OR together and would BROADEN access). Helpers eliminate per-table copy divergence. App connects as non-bypassrls `authenticated`; postgres/service_role bypass for seed/system writes.
**Alternatives rejected:** auth.uid()-based policies (EL-OS's PostgREST model) — wrong for a backend that mediates all member access; hand-written per-table policies — 38x divergence risk.
**Date:** 2026-07-02

### Content-hash embedding fixture cache (role: developer) [generalizable]
**Decision:** Cache real embeddings on disk keyed by `sha256(model|input_type|dim|text)`, commit the fixtures, and only call the provider on a cache miss. Seed/CI re-runs cost zero tokens; a live key is needed only when content changes.
**Rationale:** Real embeddings (never synthetic) + free deterministic re-runs + no provider key required in CI. Deleting a fixture forces a re-embed of exactly that text.
**Date:** 2026-07-02
