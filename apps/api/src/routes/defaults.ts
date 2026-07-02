/**
 * Platform-default `app_config.model_routing` written when a superadmin creates a tenant shell
 * (PRD-006a Q-1). Structurally valid so slot resolution never faults on a brand-new tenant;
 * PRD-008 provisioning overwrites it. Slots + providers follow the ADR-007 ratified stack.
 */
export const PLATFORM_DEFAULT_MODEL_ROUTING = {
  default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  fast: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
  deep: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  embed: { provider: 'voyage', model: 'voyage-3-large' },
  rerank: { provider: 'voyage', model: 'rerank-2' },
  stt: { provider: 'deepgram', model: 'nova-3' },
  tts: { provider: 'fish-audio', model: 'default', voice_id: null },
} as const;
