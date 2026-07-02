# ADR-007 — EL-OS stack inheritances ratified (embedding/rerank, fast slot, STT streaming, TTS)

**Date:** 2026-07-02 · **Status:** Accepted · **Decision owner:** AI Architect (ai-design phase)

## Context

`stack-canon.md` requires every substitution from the canonical defaults to be recorded as an ADR with a
flip-constraint ("substitutions are findings, not blockers; the point is preventing **silent**
substitutions"). `docs/architecture.md` §2.2 carried four EL-OS inheritances forward and flagged them
(OQ-1) but recorded no ADR — this ADR closes that gap so downstream audits cite one place.

## Decision

Ratify four inherited deviations, each with its flip-constraint and eval baseline:

### 1. Embeddings: Voyage (`voyage-3.5` @ 1024-dim) instead of canon Cohere `embed-english-v3.0`

- **Flip-constraint cited (canon §2, embedding row):** none of (a)–(c) fire *toward* Cohere; the operative
  constraint is migration cost — the EL-OS corpus and `member_facts` are embedded in Voyage's space, and
  re-embedding is a multi-week migration with no quality trigger. Same 1024-dim, same asymmetric
  input-type discipline (`document`/`query` — wrong type stays Must-fix).
- **Eval baseline:** EL-OS retrieval-precision eval (target 0.7 / alert 0.4) runs live against Voyage —
  ported as-is; re-baseline required only if a trigger fires.
- **Reversal path / trigger:** multilingual coach corpus arrives, or retrieval precision degrades below
  alert on two consecutive eval cycles → run the canon §4 slot-swap procedure with a re-embedding plan
  (both models are 1024-dim, so the pgvector schema is drop-in).
- **Ops note (ScalingCFO lesson):** live retrieval evals were starved by Voyage's free-tier 3 RPM —
  **a paid Voyage key is a build prerequisite**, and a model-slug smoke test ships in the eval harness.

### 2. Reranker: Voyage `rerank-2.5` instead of canon Cohere `rerank-v3.5`

- **Flip-constraint:** vendor-coherence with §1 (one retrieval vendor, one key, one rate-limit budget);
  cross-encoder class is identical and rule 6 (two-stage, K=20→N=5) is unchanged.
- **Eval baseline / reversal:** same retrieval-precision eval and same trigger as §1; the reranker is
  isolated behind the Sport reranker port, so a swap is a config + port change.

### 3. Fast/classify slot: Claude Haiku (via OpenRouter) instead of canon 8B-class open-weights

- **Flip-constraint cited (canon §2, fast row):** the named alternative "provider's small/mini model,"
  adopted with evidence — EL-OS routing-accuracy eval holds ≥ 0.9 (alert 0.85) on the golden set with
  Haiku at temp 0.
- **Reversal path:** if routing accuracy on the golden set is matched within 2% by an 8B-class model at
  lower cost, flip the slot value (config edit + invalidation; no code change).

### 4. STT streaming + per-coach TTS voice clone (outside canon defaults)

- **STT:** Deepgram `nova-3` matches canon; **streaming** STT (canon: "planned extension, not a
  substitution") is accepted as a pre-existing, working EL-OS capability — `apps/voice` (Pipecat) already
  implements it and voice is the P0 differentiator. Batch STT remains the ingestion default.
- **TTS:** Fish-audio voice clone, `tts.voice_id` **per tenant** (the coach's voice persona, ADR-002 §3).
  Canon has no TTS layer; recorded here so audits don't flag it as an unrecorded vendor. Flip trigger:
  Fish-audio availability/cost regression → TTS sits behind the Sport `tts` slot + voice adapter, swap is
  config + adapter.

## Consequences

- OQ-1 in `docs/architecture.md` is closed: the inheritances are recorded, eval-gated, and carry named
  reversal triggers instead of standing as silent drift.
- Vendor concentration on Voyage for the whole retrieval path is accepted; the mitigation is the eval alert
  threshold plus the isolated embedder/reranker ports.
- The paid-Voyage-key prerequisite and the model-slug smoke test move into the build plan (they blocked
  ScalingCFO's ship gate; they will not block ours).

## Alternatives rejected

- **Re-embed to canon Cohere now.** Rejected: multi-week migration, zero current quality trigger, and the
  seed corpus (Luminify) would still need Voyage parity evals for EL-OS-ported golden sets.
- **Leave the deviations as an open question (status quo).** Rejected: canon treats unrecorded
  substitutions as Must-fix findings at every audit.
