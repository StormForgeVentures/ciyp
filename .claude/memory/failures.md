# Project Memory — Failures

> What broke, why, and the fix. The most valuable file in project memory — failures are where
> skills come from. Write here when: a test fails and gets fixed, a human corrects you, or your
> 3-attempt loop exhausts and you escalate.
> Tag `[generalizable]` + `(role: <your-role>)` when the root cause isn't project-specific.

Format per entry:

### <what failed> (role: <role>) [generalizable]?
**Symptom:** what was observed
**Root cause:** the actual why (not the first guess)
**Fix:** what resolved it
**Lesson:** the reusable insight, one sentence
**Date:** YYYY-MM-DD

---

## 2026-07-02 — vitest vi.fn + generic function type: let contextual typing infer [generalizable] (role: developer)
When a vi.fn mock must satisfy a GENERIC function-type property (e.g. `traceAICall: <T>(opts: TraceAICallOpts<T>) => Promise<T>`), do NOT annotate the mock's parameter/generics explicitly — `vi.fn(async <T>(o: TraceAICallOpts<T>) => ...)` collapses to `Mock<(o: TraceAICallOpts<unknown>) => Promise<unknown>>` which is NOT assignable to the generic type (TS2322 "unknown not assignable to T"). Instead write `vi.fn(async (o) => ...)` inside a literal that is contextually typed by the target (e.g. `const s: AgentSubstrate = { traceAICall: vi.fn(async (o) => ...) }` or a function with return type `AgentSubstrate`) — contextual typing re-infers the generic correctly. If the mock is a standalone const you still need for `.toHaveBeenCalled` assertions, type its param via `Parameters<Fn>[0]` and cast at the assignment site (`x as unknown as Fn`); the runtime object stays the mock so `expect(x)` still works. Also: `noUncheckedIndexedAccess` + a no-arg `vi.fn(() => ...)` makes `mock.calls[0][0]` a TS2493 (tuple length 0) — give the mock a typed param so `calls[0]` carries the arg.
