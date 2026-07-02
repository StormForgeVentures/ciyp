/**
 * Type guards for rendering `parts` safely (contract 06 — the helpers the UI needs).
 * The renderer is a pure function of parts[]; these narrow the frozen union.
 */
import type {
  AudioPart,
  LibraryCitationPart,
  MessagePart,
  ProcessOfferPart,
  TextPart,
  VoiceInputRefPart,
} from './contracts/coaching-api.js';

export const isTextPart = (p: MessagePart): p is TextPart => p.type === 'text';

export const isAudioPart = (p: MessagePart): p is AudioPart => p.type === 'audio';

export const isLibraryCitationPart = (p: MessagePart): p is LibraryCitationPart =>
  p.type === 'library_citation';

export const isProcessOfferPart = (p: MessagePart): p is ProcessOfferPart =>
  p.type === 'process_offer';

export const isVoiceInputRefPart = (p: MessagePart): p is VoiceInputRefPart =>
  p.type === 'voice_input_ref';
