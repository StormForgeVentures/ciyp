/**
 * @ciyp/agents — the pure brain. Scaffold only (PRD-001a); the EL-OS port lands in PRD-002a.
 *
 * PURITY RULE (enforced by scripts/dependency-lint.mjs, ADR-006):
 * dependencies are EXACTLY @stormforgeventures/ciyp-shared + zod. No provider SDK, no Supabase, no Sport,
 * no direct Pi-engine imports. All LLM/DB access arrives via the injected AgentSubstrate.
 */
import type { InteractionMode } from '@stormforgeventures/ciyp-shared';

/** The injectable boundary every LLM-touching agent receives (EL-OS pattern, PRD-002a). */
export interface AgentSubstrate {
  llm: (req: { slot: string; system: string; user: string }) => Promise<{ text: string }>;
  getModelSlot: (slot: string) => Promise<{ provider: string; model: string }>;
  traceAICall: <T>(kind: string, run: () => Promise<T>) => Promise<T>;
}

/** Placeholder proving the scaffold typechecks against @stormforgeventures/ciyp-shared; replaced in PRD-002a. */
export const AGENTS_SCAFFOLD_VERSION = '0.0.0';
export type { InteractionMode };
