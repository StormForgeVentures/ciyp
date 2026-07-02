---
for_agent: |
  Lifecycle = location (CLAUDE.md `Lifecycle: by-folder`). PRDs are FOLDERS named
  prd-NNN-slug/ living in exactly one of: backlog/ (specced, not started),
  in-work/ (a wave is executing it), completed/ (accepted at the acceptance gate).
  Promote by moving the WHOLE folder (git mv); never record status in frontmatter —
  there is deliberately no Status field anywhere. Numbering: NNN is repo-local
  sequential across ALL THREE folders (scan all, take max+1, zero-pad to 3).
  Each PRD folder: prd-NNN-slug-index.md (module view) + prd-NNN<letter>-*.md
  (sub-features, feature-level ACs) + qa/ (authored ONLY by qa-reviewer) +
  tasks-NNN-slug.md (generate-tasks output). ACs ledger to handoff/acceptance-ledger.md.
for_human: |
  Task/PRD home. A PRD's folder location IS its status — backlog, in-work, or
  completed. Open a PRD folder's index file for the module overview.
---

# docs/tasks — PRD lifecycle root

- `backlog/` — specced, not yet started
- `in-work/` — currently being built (a wave references it)
- `completed/` — accepted (human acceptance gate passed)

**Move rule:** promotion is a whole-folder move between these directories. Never a status field edit.
