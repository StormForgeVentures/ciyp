---
for_agent: |
  Cross-wave handoff state for multi-agent work. project-state.md is the append-only
  binding-decisions log (PM maintains; supersede, never delete). wave-plan.md is the live wave/track
  plan. Write only these handoff artifacts here; task PRDs and checklists belong in docs/tasks/, not
  here. Every agent reads project-state.md at startup instead of replaying upstream artifacts.
for_human: |
  Handoff infrastructure for wave-based multi-agent work. project-state.md is the append-only log of
  binding decisions the PM maintains across waves; wave-plan.md is the live plan of which tasks run
  in which wave. Read these to see what the team has committed to and what is in flight.
---

# Handoff

Cross-wave coordination state for multi-agent builds.

- `project-state.md` — append-only binding-decisions log. The PM maintains it; entries are
  superseded ("supersedes #N"), never deleted. Every agent reads it at startup so it inherits
  upstream decisions instead of replaying upstream artifacts.
- `wave-plan.md` — the live wave/track plan: which tasks run concurrently in each wave and what each
  one needs as input.

Task PRDs and checkbox task lists do not live here — they belong in `docs/tasks/`.
