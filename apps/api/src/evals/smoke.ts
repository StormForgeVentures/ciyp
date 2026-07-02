/**
 * Model-slug smoke test (PRD-002d §4.4 / AC-5, the ScalingCFO decision-#26 lesson): a
 * 1-token completion against every chat-capable slot of a tenant. An empty/errored
 * completion FAILS LOUDLY, naming the slot and slug — no silent placeholder replies
 * anywhere in the runtime. The completion caller is injectable so the guard test can
 * plant an empty-returning slug and assert the loud failure without a network hop.
 */
import { createCiypSlotResolver, slotScopeFor } from '../lib/sport/slot-resolver.js';
import type { CiypScope } from '../lib/sport/scope-resolver.js';

/** Chat-capable slots that must produce a non-empty 1-token completion. */
export const CHAT_CAPABLE_SLOTS = ['default', 'fast', 'deep', 'worker', 'synthesis'] as const;

/** A 1-token completion probe: returns the model's text (empty string = failure). */
export type SmokeCaller = (provider: string, model: string) => Promise<string>;

export class SlugSmokeError extends Error {
  constructor(
    public readonly slot: string,
    public readonly slug: string,
    detail: string,
  ) {
    super(`model-slug smoke FAILED for slot '${slot}' slug '${slug}': ${detail}`);
    this.name = 'SlugSmokeError';
  }
}

const openRouterProbe: SmokeCaller = async (provider, model) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('no OPENROUTER_API_KEY');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
};

export interface SmokeOptions {
  scope: CiypScope;
  caller?: SmokeCaller;
  slots?: readonly string[];
}

/**
 * Run the smoke test over a tenant's chat-capable slots. Throws `SlugSmokeError` on the
 * first empty/errored completion (loud fail). Only OpenRouter-provider slots are probed
 * (Voyage embed/rerank slots are not chat-capable).
 */
export async function runSlugSmoke(opts: SmokeOptions): Promise<{ slot: string; slug: string }[]> {
  const caller = opts.caller ?? openRouterProbe;
  const resolver = createCiypSlotResolver();
  const slotScope = slotScopeFor(opts.scope);
  const probed: { slot: string; slug: string }[] = [];

  for (const slot of opts.slots ?? CHAT_CAPABLE_SLOTS) {
    const lookup = await resolver.tryGetModelSlot(slotScope, slot);
    if (!lookup.configured) continue; // an unset optional slot is a clean absence
    const { provider, model } = lookup.resolution;
    if (provider !== 'openrouter') continue; // only chat-capable providers
    let text: string;
    try {
      text = await caller(provider, model);
    } catch (err) {
      throw new SlugSmokeError(slot, model, (err as Error)?.message ?? String(err));
    }
    if (text.trim() === '') throw new SlugSmokeError(slot, model, 'empty completion');
    probed.push({ slot, slug: model });
  }
  return probed;
}
