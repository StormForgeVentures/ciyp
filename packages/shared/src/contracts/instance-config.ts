/**
 * Contract 01 — Instance Config (platform → UI).
 * Frozen at v1, additive-only. Source: docs/contracts/01-instance-config.md.
 *
 * The member UI renders itself entirely from this read model. No engine secrets or full
 * model identifiers cross this boundary: no provider keys, no voice_id, no prompt_fragment.
 */
import { z } from 'zod';

export const Archetype = z.object({
  id: z.string().uuid(),
  /** Stable slug, e.g. "operator". Tenant-authored (ADR-002) — never a platform enum. */
  key: z.string(),
  label: z.string(),
  description: z.string(),
  sort: z.number().int(),
  // NOTE: prompt_fragment is NOT exposed to the UI (engine-only).
});
export type Archetype = z.infer<typeof Archetype>;

export const Tier = z.object({
  id: z.string().uuid(),
  /** e.g. "core" | "premium" — tenant-authored (ADR-002). */
  key: z.string(),
  label: z.string(),
  description: z.string(),
  sort: z.number().int(),
});
export type Tier = z.infer<typeof Tier>;

export const Journey = z.object({
  id: z.string().uuid(),
  /** A cadence/program slug, e.g. "daily_checkin". */
  key: z.string(),
  label: z.string(),
  modality: z.enum(['voice', 'guided', 'text']),
  sort: z.number().int(),
});
export type Journey = z.infer<typeof Journey>;

export const Branding = z.object({
  coachDisplayName: z.string(),
  /** Member-facing name of the pocket coach. */
  productName: z.string(),
  logoUrl: z.string().url().nullable(),
  /** Token OVERRIDES only; base tokens come from @ciyp/ui-tokens (contract 06). */
  themeTokens: z.record(z.string(), z.string()).default({}),
});
export type Branding = z.infer<typeof Branding>;

export const UiModelRouting = z.object({
  /** UI-relevant subset only — never full provider/model/keys. */
  voiceEnabled: z.boolean(),
  /** Human label for the voice persona (never the voice_id). */
  voiceLabel: z.string().nullable(),
  sttEnabled: z.boolean(),
});
export type UiModelRouting = z.infer<typeof UiModelRouting>;

export const InstanceConfig = z.object({
  tenantId: z.string().uuid(),
  /** Bumps on any config change; the UI revalidates (ETag) on change. */
  configVersion: z.number().int(),
  /** Pins AI behavior; ties to prompt_versions / eval_snapshots. */
  promptSetVersion: z.string(),
  /** ADR-001 promotion seam: dedicated-tenant promotion repoints this. */
  engineBaseUrl: z.string().url(),
  branding: Branding,
  archetypes: z.array(Archetype),
  tiers: z.array(Tier),
  journeys: z.array(Journey),
  ui: UiModelRouting,
});
export type InstanceConfig = z.infer<typeof InstanceConfig>;
