# QA — Wave 0 (Foundation Scaffold + Contract Freeze)

**Reviewer:** qa-reviewer · **Date:** 2026-07-02 · **Commit:** `b519f12` (main, tree clean)
**Scope:** PRD-001a (FR-1..9, AC-1..6) + PRD-001 index AC-1/AC-2 · task list 1.0 / 2.1 / 2.2 (2.3 BLOCKED-external) · ledger rows -01,-02,-05..-10 · contracts 01–06 field-by-field.

## Verdict

Wave-0 material is solid and shippable. **Zero Must-fix.** The highest-value check — the six frozen
contracts vs `docs/contracts/*.md` — is **clean field-for-field** (names, types, nullability, enums,
defaults). Gates all green from a real run; the API scaffold boots and serves live; both purity gates fire
on planted violations. Findings below are two Should-fix (a purity-gate bypass I proved, and a missing
test on the second frozen union) and four Notes.

## Gate results (actual runs, repo root)

| Gate | Command | Exit | Evidence |
|---|---|---|---|
| Install | `pnpm install` | 0 | "Already up to date" |
| Typecheck | `pnpm typecheck` | 0 | 6 packages, FULL TURBO |
| Build | `pnpm build` | 0 | web `vite build` 73 modules; api/shared/ui-tokens tsc |
| Test | `pnpm test` | 0 | shared 15/15, api 1/1, dependency-lint ✓ |
| AC-1 literal | `pnpm -r typecheck && pnpm -r build` | 0 / 0 | every workspace green |
| Index AC-2 | `pnpm --filter @stormforgeventures/ciyp-shared typecheck` | 0 | standalone; shared deps = `zod` only; no cross-package/apps imports |
| Boot | `PORT=8793 pnpm dev` + `curl /health` | 200 | `{"ok":true,"scaffold":{"agents":"0.0.0","prompts":"0.0.0","partsUnionLoaded":true}}`; unknown route → 404 |
| Purity clean | `node scripts/dependency-lint.mjs` | 0 | agents purity + prompts zero-deps + no earendil |

## Contract field-by-field diff (schemas vs docs/contracts/01–06)

**No drift.** Verified each schema in `packages/shared/src/contracts/` against its spec:

- **01 Instance Config** — `Archetype/Tier/Journey/Branding/UiModelRouting/InstanceConfig` all match, incl.
  `themeTokens: z.record(z.string(),z.string()).default({})`, `logoUrl/voiceLabel` nullable, `modality`
  enum `['voice','guided','text']`. ✓
- **02 Coaching API** — `parts` union closed over the 5 frozen kinds; `ChatTurnRequest.interactionMode`
  default `'free'`; `ChatTurnEvent` 6 frames; `CheckinStartRequest`, `VoiceSessionStart*` all match. ✓
- **03 Usage Event** — `UsageFeature` 9 values; `promptTokens/completionTokens/units` default 0,
  `nonnegative`; `costMicros` int nonnegative; `spendClass ['cheap','heavy']`; `memberId` nullable. ✓
- **04 Spend Authorization** — `AuthorizeRequest/Response` (`reason` default `'ok'`), `SettleRequest` match;
  code additionally exports `AuthorizeRequest`/`SettleRequest` types (additive, fine). ✓
- **05 Entitlement** — `status` 6-value enum, `source: z.literal('stripe')`, `tierKey/currentPeriodEnd/
  trialEnd` nullable all match. The `'api'`-widening note (008a FR-9) is documented in-code as *additive,
  wire stays 'stripe' at v1* — correct per §13 discipline. ✓
- **06 Shared-core API** — published surface matches the manifest: `contracts/index.ts` re-exports all
  named schemas; `src/index.ts` re-exports contracts + enums + guards; the manifest test asserts every
  pinned name is present. Packed tarball (`pnpm pack`) confirms `main/types/exports` rewrite to `dist/*`
  and `dist/contracts/` ships. ✓

## Findings

### Should-fix

**SF-1 · Purity gate misses `optionalDependencies` / `peerDependencies` (proven bypass).**
`scripts/dependency-lint.mjs:18` (`agents`) and `:28` (`prompts`) read **only** `pkg.dependencies`.
AC-2/FR-4 require agents deps to be *exactly* `{@stormforgeventures/ciyp-shared, zod}` and "fail on any addition"; a disallowed
**runtime** dependency declared under `optionalDependencies` (or `peerDependencies`) installs at runtime yet
escapes the gate.
Repro (planted then reverted, tree clean): added `"optionalDependencies": {"left-pad":"^1.3.0"}` to
`packages/agents/package.json` → `node scripts/dependency-lint.mjs` exited **0** (should be 1). The
`dependencies`-plant control fired correctly (exit 1). Fix: union `dependencies ∪ optionalDependencies ∪
peerDependencies` before the exact-set check, for both gate 1 and gate 2.

**SF-2 · The `ChatTurnEvent` SSE union has zero fixture/test coverage.**
Contract 02 §1 defines a *second* load-bearing discriminated union (`ChatTurnEvent`, 6 event frames) that
travels the SSE wire. The suite proves the `parts` union closed (AC-5) but never parses a single
`ChatTurnEvent` frame or an unknown `event`. A dropped frame or an accidental non-discriminated union would
pass every test. FR-7 is satisfied at contract granularity, but this union warrants the same
valid-frames + closed-union test `parts` received. (`packages/shared/test/contracts.test.ts` — add a
`contract 02 — SSE events` block.)

### Note

**N-1 · dependency-lint gate 3 matches any `@earendil-works/` substring, not just imports**
(`scripts/dependency-lint.mjs:53` `text.includes(...)`). Errs safe (never misses a real import) but is
false-positive prone: a doc comment or string literal naming the package fails the build — the task-list
1.3 note ("a literal earendil-pattern occurrence was caught live during the build") is this behavior. AC-3
says "importing"; consider matching `import/from/require` statements to avoid tripping on prose.

**N-2 · CI voice step lacks `actions/setup-python` and a version pin** (`.github/workflows/ci.yml`, "Voice
(Python) tests"). It runs `python -m pip install -r requirements-dev.txt && python -m pytest` against the
runner's ambient `python`. `requirements-dev.txt`, `pytest.ini`, and `tests/test_scaffold.py` exist, but
with no pinned interpreter a future `ubuntu-latest` image change can break voice tests silently. **Not
locally verifiable** — this host has no python env (matches the task-list 1.2 note). Add a pinned
`actions/setup-python` step.

**N-3 · `/health` returns a superset of the spec's `{ ok: true }`** — it adds `scaffold{agents,prompts,
partsUnionLoaded}`. Additive and useful (proves the frozen parts-union imports at the engine edge); not a
defect, logged for spec-vs-impl traceability (FR spec says `{ ok: true }`).

**N-4 · Valid-only / no fixtures for several contract-02/04 schemas** (`VoiceSessionStartResponse`,
`AuthorizeResponse`, `CheckinStartRequest`, `VoiceSessionStartRequest`, `SettleRequest`). FR-7 met per
contract; worth round-trip coverage as these gain runtime use.

## Fixture-suite quality (spot-check)

- Every contract **01–05** has a valid + an invalid fixture; **06** has the export-surface manifest test.
- Each invalid fixture violates **exactly** its stated field (spread from the valid + one mutation):
  01 `engineBaseUrl:'not-a-url'`, 02 `clientMsgId:'not-a-uuid'`, 03 `costMicros:-1`, 04 `spendClass:'medium'`,
  05 `source:'paypal'`. Verified non-tautological — e.g. loosening `engineBaseUrl.url()` would make the
  invalid fixture parse and fail the test (real drift catcher).
- The parts closed-union test is genuine: `{type:'sparkline',…}` fails the discriminator (AC-5). ✓
- Note: I could not run a **schema mutation** check (write scope is test/report/ledger only, and the task
  bars editing `src/`); confidence on the union tests rests on structural reading, not an injected src bug.

## Task-list claims vs reality

All checked boxes are **true**. 1.1/1.2/1.3/1.4, 2.1, 2.2 verified as claimed (gate exits, purity plants,
15/15 tests, standalone shared typecheck). **2.3 BLOCKED-external note is accurate** — the publish *shape*
is proven (pack tarball has correct `dist`-rewritten manifest + `dist/contracts/`), and the remaining step
(create GitHub repo under `theamazingwolf`, push, tag `shared-v0.1.0`) genuinely cannot execute without the
repo + org token. Correctly BLOCKED, not a false claim.

## Ledger rows flipped (Verifier = qa-reviewer, differs from Owner = developer)

| Row | AC | DONE→VERIFIED | Evidence |
|---|---|---|---|
| -01 | index AC-1 | VERIFIED | install/build/typecheck/test all exit 0 (this run) |
| -02 | index AC-2 | VERIFIED | shared standalone typecheck exit 0; deps=zod only; no apps/cross-package imports |
| -05 | 001a AC-1 | VERIFIED | `pnpm -r typecheck` & `pnpm -r build` both exit 0 |
| -06 | 001a AC-2 | VERIFIED | planted `left-pad` in agents deps → exit 1, purity message (SF-1 caveats scope) |
| -07 | 001a AC-3 | VERIFIED | planted `@earendil-works/*` import → exit 1 citing ADR-006 |
| -08 | 001a AC-4 | VERIFIED | 15/15; valid parses / invalid throws per contract |
| -09 | 001a AC-5 | VERIFIED | unknown `parts.kind` rejected (closed union) |
| -10 | 001a AC-6 | **left BLOCKED** | publish shape proven via pack; true external publish needs the GitHub repo/org token — cannot verify end-to-end |

**Caveat on -06:** verified against the stated behavior, but SF-1 shows the gate has an `optionalDependencies`/
`peerDependencies` bypass. The AC as literally worded ("dependencies … exactly") passes; the *intent*
(purity) has a hole. Flagged rather than blocking the flip.
