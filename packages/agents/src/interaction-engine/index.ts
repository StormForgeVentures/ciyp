/**
 * The generalized mode-driven interaction engine. A SMALL STATE MACHINE THE AI
 * DRIVES by switching interaction modes — NOT a step-player walking a pre-authored
 * line array. The AI natively decides which mode each moment needs (`instruct` /
 * `call_response` / `free` / `hold`), generates the actual line, and signals the mode
 * to the engine via the `set_interaction_mode` tool. The engine applies that mode's
 * turn-taking and emits custom UI-sync events.
 *
 * Per-mode turn-taking:
 *   - instruct       : AI speaks, member listens; AUTO-ADVANCE after the TTS completes.
 *   - call_response  : AI reads a line, member repeats; advance on detected
 *                      repeat-after-me turn-end (VAD) or explicit "next". This
 *                      OVERRIDES the global finish-sentence barge-in default — for
 *                      call_response ONLY (must NOT leak into `free`/free-form).
 *   - free           : open question, NORMAL conversational turn (finish-sentence holds).
 *   - hold           : timed silent action; advance on TIMER or explicit member "done".
 *
 * The drift invariant: EVERY AI-generated line passes the full cascade + linter chain
 * (the engine calls the injected `vetLine`, wired to `runLinterChain`). The ONLY
 * exception is explicitly `pinned` lines — read VERBATIM, bypassing the linters
 * (admin-vetted).
 *
 * UI-sync events ride the same transient bus: `interaction_mode`, `awaiting_response`,
 * `step_advanced`, `process_complete` — NOT persisted parts.
 *
 * Purity: the engine imports no LLM/store/transport. It takes injected callbacks
 * (`emit`, `speak`, `vetLine`, `trace`) so it reuses unchanged in text or voice.
 */
import type { InteractionMode } from '../orchestrator/tools.js';

export type { InteractionMode } from '../orchestrator/tools.js';

/** The barge-in policy the engine resolves per mode. call_response is the ONLY override. */
export type BargeInPolicy = 'finish_sentence' | 'wait_for_repeat';

/** Resolve the barge-in policy for a mode. call_response is the ONLY override. */
export function bargeInPolicyFor(mode: InteractionMode): BargeInPolicy {
  return mode === 'call_response' ? 'wait_for_repeat' : 'finish_sentence';
}

/** A custom UI-sync event the engine emits (transient; mirrors the voice bus). */
export type InteractionEvent =
  | { type: 'interaction_mode'; mode: InteractionMode }
  | { type: 'awaiting_response' }
  | { type: 'step_advanced'; step: number }
  | { type: 'process_complete' };

/** A line the AI generated live, OR a pinned (admin-vetted, verbatim) line. */
export interface EngineLine {
  text: string;
  mode: InteractionMode;
  /** True for an exact-wording moment (mantra) — read VERBATIM, bypass the linters. */
  pinned?: boolean;
}

/** How a turn ends — the engine waits for the right signal per mode. */
export type TurnEndSignal = 'tts_complete' | 'vad_turn_end' | 'explicit_next' | 'timer';

export interface EngineCallbacks {
  /** Emit a UI-sync event (voice WS / SSE custom bus). */
  emit: (event: InteractionEvent) => void | Promise<void>;
  /** TTS-render (voice) or display (text) the vetted line; resolves when done. */
  speak: (text: string) => void | Promise<void>;
  /**
   * Vet an AI-generated line through the cascade + linter chain (the runtime wires
   * this to `runLinterChain` — the drift invariant). Returns the (possibly
   * normalized) final text. NOT called for pinned lines (they bypass).
   */
  vetLine: (text: string, mode: InteractionMode) => Promise<string>;
  /** Trace hook (the runtime wraps traceAICall). Optional. */
  trace?: (event: string, data?: Record<string, unknown>) => void;
}

export interface EngineState {
  step: number;
  currentMode: InteractionMode | null;
  complete: boolean;
}

export function createInitialEngineState(): EngineState {
  return { step: 0, currentMode: null, complete: false };
}

/**
 * The interaction engine. The AI drives it by calling `setMode` (via the
 * orchestrator's `set_interaction_mode` tool) and `deliverLine` (the line it
 * generated). The engine vets the line (unless pinned), speaks it, emits the
 * mode/advance events, and returns the turn-end signal the mode waits on.
 */
export class InteractionEngine {
  private state: EngineState = createInitialEngineState();

  constructor(private readonly cb: EngineCallbacks) {}

  getState(): EngineState {
    return { ...this.state };
  }

  /** The AI signals a mode change (via set_interaction_mode). Emits the UI event. */
  async setMode(mode: InteractionMode): Promise<void> {
    this.state.currentMode = mode;
    await this.cb.emit({ type: 'interaction_mode', mode });
    this.cb.trace?.('interaction_mode_set', { mode });
  }

  /**
   * The AI delivers a line in the current (or given) mode. The engine vets it
   * (unless pinned — verbatim bypass), speaks it, then applies the mode's turn-taking
   * + emits the right events. Returns the turn-end signal the runtime waits on before
   * advancing.
   */
  async deliverLine(line: EngineLine): Promise<TurnEndSignal> {
    const mode = line.mode;
    if (this.state.currentMode !== mode) {
      await this.setMode(mode);
    }

    // AI-generated lines DO pass the cascade + linter chain (the drift invariant).
    // ONLY explicitly pinned lines bypass (verbatim, admin-vetted).
    const text = line.pinned ? line.text : await this.cb.vetLine(line.text, mode);
    await this.cb.speak(text);

    return this.applyTurnTaking(mode);
  }

  /** Apply a mode's turn-taking: emit the awaiting/advance events; return the signal. */
  private async applyTurnTaking(mode: InteractionMode): Promise<TurnEndSignal> {
    switch (mode) {
      case 'instruct':
        // AI spoke; auto-advance after the TTS completed.
        await this.advance();
        return 'tts_complete';
      case 'call_response':
        // Repeat-after-me — WAIT for the member to repeat; advance on detected
        // turn-end or explicit "next". The barge-in override is scoped HERE only.
        await this.cb.emit({ type: 'awaiting_response' });
        return 'vad_turn_end';
      case 'free':
        // Open question — normal conversational turn (finish-sentence default holds).
        await this.cb.emit({ type: 'awaiting_response' });
        return 'vad_turn_end';
      case 'hold':
        // Timed silent action — advance on the timer or an explicit member continue.
        return 'timer';
    }
  }

  /** Advance the step counter + emit step_advanced. */
  async advance(): Promise<void> {
    this.state.step += 1;
    await this.cb.emit({ type: 'step_advanced', step: this.state.step });
  }

  /**
   * The member finished their turn (VAD turn-end / explicit next / hold timer fired).
   * Advances the engine. The caller (runtime) invokes this when the awaited signal
   * arrives; for `instruct` the engine already advanced in `deliverLine`.
   */
  async resolveTurn(): Promise<void> {
    await this.advance();
  }

  /** Finish the process — emit process_complete. */
  async complete(): Promise<void> {
    this.state.complete = true;
    await this.cb.emit({ type: 'process_complete' });
    this.cb.trace?.('coaching_process_completed');
  }
}
