/**
 * Contract fixture suite (prd-001a FR-7 / AC-4, AC-5) + the contract-06 export-surface
 * test. Every contract parses its valid fixture and rejects its invalid one; the parts
 * union is proven CLOSED; the published surface matches contract 06's manifest.
 */
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';
import {
  AuthorizeRequest,
  AuthorizeResponse,
  ChatTurnRequest,
  Entitlement,
  InstanceConfig,
  MessagePart,
  UsageEvent,
  VoiceSessionStartResponse,
} from '../src/contracts/index.js';
import * as fx from './fixtures/contracts.js';

describe('contract 01 — Instance Config', () => {
  it('parses the valid fixture', () => {
    expect(InstanceConfig.parse(fx.validInstanceConfig).tenantId).toBe(
      fx.validInstanceConfig.tenantId,
    );
  });
  it('rejects the invalid fixture (non-URL engineBaseUrl)', () => {
    expect(() => InstanceConfig.parse(fx.invalidInstanceConfig)).toThrow();
  });
});

describe('contract 02 — Coaching API', () => {
  it('parses the valid turn request', () => {
    expect(ChatTurnRequest.parse(fx.validChatTurnRequest).interactionMode).toBe('free');
  });
  it('rejects the invalid turn request (non-uuid clientMsgId)', () => {
    expect(() => ChatTurnRequest.parse(fx.invalidChatTurnRequest)).toThrow();
  });
  it('parses every part kind in the frozen union', () => {
    for (const part of fx.validMessageParts) {
      expect(MessagePart.parse(part).type).toBe(part.type);
    }
  });
  it('rejects an unknown part kind — the union is closed at v1 (AC-5)', () => {
    expect(() => MessagePart.parse(fx.unknownKindPart)).toThrow();
  });
  it('parses the voice session start response', () => {
    expect(VoiceSessionStartResponse.parse(fx.validVoiceSessionStartResponse).sessionId).toBe(
      fx.validVoiceSessionStartResponse.sessionId,
    );
  });
});

describe('contract 03 — Usage Event', () => {
  it('parses the valid fixture', () => {
    expect(UsageEvent.parse(fx.validUsageEvent).idempotencyKey).toContain('trace:');
  });
  it('rejects the invalid fixture (negative costMicros)', () => {
    expect(() => UsageEvent.parse(fx.invalidUsageEvent)).toThrow();
  });
});

describe('contract 04 — Spend Authorization', () => {
  it('parses the valid authorize request/response', () => {
    expect(AuthorizeRequest.parse(fx.validAuthorizeRequest).spendClass).toBe('heavy');
    expect(AuthorizeResponse.parse(fx.validAuthorizeResponse).reason).toBe(
      'insufficient_balance',
    );
  });
  it('rejects the invalid request (unknown spendClass)', () => {
    expect(() => AuthorizeRequest.parse(fx.invalidAuthorizeRequest)).toThrow();
  });
});

describe('contract 05 — Entitlement', () => {
  it('parses the valid fixture', () => {
    expect(Entitlement.parse(fx.validEntitlement).status).toBe('active');
  });
  it("rejects the invalid fixture (source must be 'stripe' at v1)", () => {
    expect(() => Entitlement.parse(fx.invalidEntitlement)).toThrow();
  });
});

describe('contract 06 — published surface manifest', () => {
  it('exports every name contract 06 pins', () => {
    const manifest = [
      // 01
      'InstanceConfig', 'Archetype', 'Tier', 'Journey', 'Branding', 'UiModelRouting',
      // 02
      'MessagePart', 'TextPart', 'AudioPart', 'LibraryCitationPart', 'ProcessOfferPart',
      'VoiceInputRefPart', 'ChatTurnRequest', 'ChatTurnEvent', 'CheckinStartRequest',
      'VoiceSessionStartRequest', 'VoiceSessionStartResponse',
      // 03
      'UsageEvent', 'UsageFeature',
      // 04
      'AuthorizeRequest', 'AuthorizeResponse', 'SettleRequest',
      // 05
      'Entitlement',
      // enums (ADR-002 stay-list, exported per contract 06)
      'InteractionMode', 'CoachingModality', 'ChatThreadState', 'ChatMessageRole',
      // guards
      'isTextPart', 'isAudioPart', 'isLibraryCitationPart', 'isProcessOfferPart',
      'isVoiceInputRefPart',
    ] as const;
    for (const name of manifest) {
      expect(shared, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('renders parts through the guards (renderer is a pure function of parts[])', () => {
    const parts = fx.validMessageParts.map((p) => MessagePart.parse(p));
    expect(parts.filter(shared.isTextPart)).toHaveLength(1);
    expect(parts.filter(shared.isAudioPart)).toHaveLength(1);
    expect(parts.filter(shared.isLibraryCitationPart)).toHaveLength(1);
    expect(parts.filter(shared.isProcessOfferPart)).toHaveLength(1);
    expect(parts.filter(shared.isVoiceInputRefPart)).toHaveLength(1);
  });
});
