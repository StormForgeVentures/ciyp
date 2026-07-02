---
for_agent: |
  Lifecycle = location. Folders here have an executing wave. Promote by moving the
  whole prd-NNN-slug/ folder to ../completed/ ONLY after the acceptance gate
  (QA pass + human acceptance); regress to ../backlog/ if work is descoped before
  any wave lands. Never edit status in frontmatter alone — location is the truth.
  QA reports land in the folder's qa/ subfolder, authored by qa-reviewer only.
for_human: |
  Actively being built. Check the folder's tasks-NNN-*.md for checkbox progress
  and qa/ for review findings.
---

# in-work/ — a wave is executing this
