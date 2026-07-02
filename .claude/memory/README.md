---
for_agent: |
  Project episodic memory — lessons that live and die with this project. Write only the three
  maintained logs here: decisions.md, failures.md, conventions.md. Append to the existing log that
  fits; do NOT create new top-level files in this folder. Generalizable lessons get tagged
  [generalizable] for later distillation — they do not move to cadre canon from here. This folder is
  project-scoped: never copy its contents into another project.
for_human: |
  Project memory. The agents append decisions, failures, and conventions here as they work; this is
  where project-specific lessons accumulate. `cadre distill` later harvests entries tagged
  [generalizable] into the cross-project skill library — nothing enters team canon automatically.
  Prune at wave boundaries if it grows noisy.
---

# Project memory

Episodic memory for this project. Three maintained logs:

- `decisions.md` — architecture/design choices and why.
- `failures.md` — what broke, the root cause, and the fix (where skills come from).
- `conventions.md` — "here, we do X" rules discovered or established during the build.

Agents append to the log that fits; they never create new top-level files here. Entries tagged
`[generalizable]` are candidates for `cadre distill` — they stay project-scoped until a reviewed
merge promotes them to cadre canon.
