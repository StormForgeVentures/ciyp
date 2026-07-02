# Wave Plan — ciyp-platform v1

> Produced by the PM from the 8 PRD folders in `docs/tasks/backlog/` (task lists: `tasks-NNN-*.md` per
> folder; ACs ledgered in `handoff/acceptance-ledger.md`, 229 rows). Waves group tasks with no shared
> abstractions; parallel agents work in separate worktrees (`feature/{slug}`); merges at wave boundaries
> after QA/Security review. Notation `NNN §X.0` = parent task X.0 in `tasks-NNN-*.md`.
>
> **SDK dependency rule:** cite sport-ai-sdk issues (#25–#31), never versions. #25–#27 gate full no-deploy
> agent-studio hydration (wave 5) — the PRD-002b interim seam de-risks the schedule; #28–#31 are mid-build.

## How to structure a wave

- Every task names: owner role, worktree branch, inputs, output artifact.
- A task enters wave N only if ALL its inputs exist at the end of wave N-1.
- Two tasks touching the same abstraction never share a wave (the `Modified here` rows in each PRD's
  dependency tables are the evidence).
- QA/Security review at every wave boundary before merge; urgent security findings escalate immediately.

## Wave 0 — contract freeze (1 agent, sequential)

- [ ] developer — 001 §1.0 monorepo scaffold + purity gates (worktree: feature/foundation; inputs: docs/contracts, EL-OS ref; output: green workspace)
- [ ] developer — 001 §2.0 contract freeze + private-registry publish (same worktree; output: `@stormforgeventures/ciyp-shared`+`@stormforgeventures/ciyp-ui-tokens` published → **unblocks ciyp-template**)

## Wave 1 — substrate (parallel: 2)

- [ ] developer — 001 §3.0 + §4.0 schema, RLS, index plan, Luminify seed (feature/schema-seed; inputs: 001 §1–2; output: `pnpm db:reset && pnpm seed` green + seed-verify in CI)
- [ ] developer — 002 §1.0 engine port: pure `@ciyp/agents` + `@ciyp/prompts` (feature/engine-port; inputs: 001 §2 shared types, EL-OS ref; output: ported packages, tests green, coach-IP grep clean)

## Wave 2 — runtime + first surfaces (parallel: 3)

- [ ] developer — 002 §2.0–§4.0 Sport assembly, ports, slots, cascade, eval harness (feature/sport-runtime; inputs: waves 0–1; output: end-to-end internal turn on seed, eval suite green — module AC-001..-04)
- [ ] developer — 006 §1.0 admin shell: auth, roles, superadmin, audit log (feature/admin-shell; inputs: 001; output: tenant-fenced console live on seed)
- [ ] developer — 008 §1.1–1.3 store: webhooks, checkout, entitlement API (feature/access-store; inputs: 001; output: contract-05 reads green in test mode. §1.4 gate wiring deferred to wave 6)

## Wave 3 — grounded coaching + money substrate (parallel: 4)

- [ ] developer — 003 §1.0 + §2.0 chat turn + member memory (feature/coaching-core; inputs: 002; output: cited, metered, memory-grounded turns on seed; citation AC pends 005 §1.0 merge at boundary)
- [ ] developer — 005 §1.0 ingestion pipeline (feature/ingestion; inputs: 002 ports/slots; output: seed corpus indexed through the real pipeline)
- [ ] developer — 004 §1.0 Pipecat service port (feature/voice-service; inputs: 002 internal turn route; output: synthetic-audio session green, no-Sport-in-Python grep)
- [ ] developer — 007 §1.0 wallet + ledgers + Stripe recharge (feature/wallet; inputs: 001, 006 §1.0 shell for screens; output: materialization invariant + top-up round-trip green)

## Wave 4 — surfaces + pipelines (parallel: 4)

- [ ] developer — 003 §3.0 + §4.0 cadence + guided processes (feature/cadence-processes; inputs: 003 §1–2; output: records + doc-approved artifacts live on seed)
- [ ] developer — 005 §2.0 + §3.0 library UI + connector framework (feature/library-connectors; inputs: 005 §1.0, 006 §1.0; output: coach-operable library + OAuth vault + per-scope MCP catalog)
- [ ] developer — 007 §2.0 metering pipeline + pricebook (feature/metering; inputs: 007 §1.0, 002 §4.0 traces; output: idempotent rollup + pricebook debits on seed)
- [ ] developer — 006 §2.0 instance config authoring + contract 01 (feature/instance-config; inputs: 006 §1.0, 002 invalidation seams; output: eval-gated config edits live without deploy)

## Wave 5 — flagship + enforcement service (parallel: 3)

- [ ] developer — 006 §3.0 coach-authored agent studio (feature/agent-studio; inputs: 006 §2.0, 005 §3.0, 002 hydration seam [sport-ai-sdk #25–#27 or interim]; output: authored agent activates through eval gate, no deploy)
- [ ] developer — 007 §3.0 spend-authorization service — fills the 002b stub (feature/spend-auth; inputs: 007 §1–2; output: contract 04 real; deny→top-up→allow on seed. NOTE: never shares a wave with 004 §2.0)
- [ ] developer — 005 §4.0 Granola + Fathom providers (feature/granola-fathom; inputs: 005 §1.0+§3.0; output: fixture-backed import → indexed → cited; fidelity eval green)

## Wave 6 — hard enforcement + last-mile integration (parallel: 2, then 1)

- [ ] developer — 004 §2.0 voice spend integration + enforcement evals (feature/voice-spend; inputs: 007 §3.0 merged, 004 §1.0; output: start-refusal + mid-call cut + settle-once green)
- [ ] developer — 008 §1.4 session-start entitlement gate wired into 003a/004b + 008 §2.0 provisioning runbook + script (feature/provisioning; inputs: nearly all prior waves; output: `provision` stands a tenant up green — **the platform's integration test**)

## Acceptance

- [ ] QA full pass (qa-functional per PRD folder → `qa/` subfolders) · qa-ai audit (ten rules) · Security audit (auth/data scope, token vault, RLS sweeps) · Human acceptance test (Tim) against the 6 v1 success criteria in `docs/project-brief.md`
- [ ] Acceptance ledger: all 229 `AC-*` rows DONE or WAIVED-with-rationale

## Plan-gate decisions — RESOLVED by Tim, 2026-07-02 (project-state #13–#14)

1. **Pricebook pricing at the ledger — RATIFIED**, with shape refinement: a **default rate rule** (global
   multiplier over known provider cost) plus **editable per-model override rows**; markup remains
   **per-tenant**. (007c updated.)
2. **Store SKU — subscription is the built-in default**; coaches may also sell flat-fee or grant access
   free. NEW small scope: an **external enrollment API/webhook** (e.g. GHL adds a member → entitlement
   granted) — added as 008a FR-9. Member billing: **ADR-008 (decision #15) supersedes the earlier
   parking** — member payments run on the coach's own Stripe account via the **coach-Stripe connector**
   (GHL-style restricted API key on the 005c vault; Connect considered, not chosen, swappable behind the
   port; built in v1, 001b/008a/008b updated; no pooled funds, no platform fee). `member_billing_mode`
   (`absorbed` default | `member_credits`) is per-tenant config from v1, and the member-credits economy
   itself is **PRD-009** (backlog index locks scope + the non-preclusion constraints binding waves 1–6).
3. **Voice cut — finish the in-flight reply, then close.** Balance may go negative just enough to cover
   that final turn (explicit bounded overspend). Auto top-up ("at $2 add $10") confirmed — already
   designed as 007a auto-recharge; the append-only running-balance ledger covers the "capture every
   transactional balance" requirement.
4. **Markup default = 1.1×** (down from the 1.5× placeholder — coaches may stack their own margin later).
   Seed + intake template updated via 007a/001c open questions. Ingestion/embedding model usage is priced
   through the same pricebook (every traced call); **storage costs stay out of usage billing** — part of
   the tenant subscription/maintenance package (confirmed non-goal).
5. **OQ-2 Luminify archetypes/tiers** — confirmed: provisioning input, placeholders in seed.
