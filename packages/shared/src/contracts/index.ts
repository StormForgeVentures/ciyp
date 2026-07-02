/**
 * Contracts 01–06 — the single source of truth for the cross-repo wire (ADR-004).
 * No repo redefines a contract type locally. Additive-only evolution; a breaking change is
 * a major bump + coordinated UI upgrade + a handoff/project-state.md entry (contract 06).
 */

// 01 Instance Config
export {
  InstanceConfig,
  Archetype,
  Tier,
  Journey,
  Branding,
  UiModelRouting,
} from './instance-config.js';

// 02 Coaching API
export {
  MessagePart,
  TextPart,
  AudioPart,
  LibraryCitationPart,
  ProcessOfferPart,
  VoiceInputRefPart,
  ChatTurnRequest,
  ChatTurnEvent,
  CheckinStartRequest,
  VoiceSessionStartRequest,
  VoiceSessionStartResponse,
} from './coaching-api.js';

// 03 Usage Event (engine-internal, typed here for the ledger consumer)
export { UsageEvent, UsageFeature } from './usage-event.js';

// 04 Spend Authorization (engine-internal)
export { AuthorizeRequest, AuthorizeResponse, SettleRequest } from './spend-authorization.js';

// 05 Entitlement
export { Entitlement } from './entitlement.js';
