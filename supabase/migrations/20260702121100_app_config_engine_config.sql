-- Migration: app_config_engine_config
-- PRD-001b addendum (wave-1 engine-port handoff): the ported linter chain and the
-- doc-reference detector read two per-tenant knobs that are NOT model slots and so do
-- not belong in app_config.model_routing (which the slot resolver iterates). They live
-- in a dedicated, clearly-named per-tenant config column on app_config:
--
--   engine_config.lightnessWideningLeans : string[]  — archetype-lean keys that widen
--       the playfulness/lightness cap by 1 (linters/playfulness.ts; replaces the donor's
--       hardcoded per-archetype rule). Values are tenant archetype keys, never coach-named.
--   engine_config.memberDocCues : { kind, pattern, flags }[] — the doc-reference detector's
--       tenant cue set (orchestrator/doc-reference.ts MemberDocCue[]). RegExp is stored
--       JSONB-safe as { pattern, flags } and compiled by the runtime; `kind` is opaque.
--
-- Metadata-only add (nullable-with-default) — safe, no rewrite. Inherits app_config's
-- tenant fence + grants; no RLS change.

alter table app_config
  add column if not exists engine_config jsonb not null default '{}'::jsonb;

comment on column app_config.engine_config is
  'Per-tenant engine knobs consumed by the pure brain: lightnessWideningLeans (string[] of archetype-lean keys) + memberDocCues ({kind,pattern,flags}[]). Non-slot config — NOT model_routing.';
