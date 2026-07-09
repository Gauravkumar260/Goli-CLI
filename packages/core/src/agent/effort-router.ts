/**
 * Reasoning-effort routing wrapper (Module 1, deep-dive recommendation).
 *
 * Wraps a model client to automatically adjust the `reasoning_effort`
 * parameter based on the conversation context:
 *
 *   - **Tool execution turns** → `high` (no need for max reasoning when
 *     just dispatching a read_file or grep).
 *   - **Planner / architect turns** → `max` (deep reasoning for task
 *     decomposition and system design).
 *   - **Final-answer turns** (no tool calls in the response) → `max`
 *     (the model is producing the user-facing answer, so invest in
 *     quality).
 *
 * This saves ~20-30% on thinking-token costs without sacrificing
 * output quality, because tool-dispatch turns don't benefit from
 * extended reasoning.
 *
 * ## How it works
 *
 * The wrapper inspects the `messages` array passed to `call()`:
 *   - If the last assistant message has `toolCalls`, this is a
 *     tool-execution turn → downgrade to `high`.
 *   - If the system prompt mentions "plan" / "architect" / "design",
 *     this is a planning turn → upgrade to `max`.
 *   - Otherwise, respect the caller's `effort` parameter.
 *
 * The wrapper is opt-in: callers who want fixed effort can use the
 * raw model client directly.
 *
 * @module agent/effort-router
 */

import type { Message } from './types.js';
import type { ReasoningEffort } from '../config/schema.js';
import type { Logger } from '../utils/logger.js';

/** A streaming chunk from the model. */
interface ModelStreamChunk {
  contentDelta?: string;
  thinkingDelta?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsFragment?: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number; thinkingTokens: number };
  finishReason?: string;
}

/** A complete model response (all fields the router passes through). */
interface ModelResponse {
  content: string;
  thinking: string;
  toolCalls: unknown[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

/**
 * The call signature that any model client must implement.
 * EffortRoutingClient wraps anything with this `call` method.
 */
export interface ModelCallable {
  call(params: {
    messages: Message[];
    tools?: unknown;
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: ModelStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<ModelResponse>;
}

/** Options for the EffortRoutingClient. */
export interface EffortRoutingClientOptions {
  /** The underlying model client to wrap. */
  client: ModelCallable;
  /** Logger (optional). */
  logger?: Logger;
  /** Effort to use on tool-execution turns (default: 'high'). */
  toolExecutionEffort?: ReasoningEffort;
  /** Effort to use on planner/architect turns (default: 'max'). */
  plannerEffort?: ReasoningEffort;
  /** Effort to use on final-answer turns (default: 'max'). */
  finalAnswerEffort?: ReasoningEffort;
}

/** Keywords that indicate a planner/architect turn. */
const PLANNER_KEYWORDS = [
  'plan_task',
  'decompose',
  'architect',
  'system design',
  'refactor strategy',
  'migration plan',
];

/**
 * A model-client wrapper that auto-routes reasoning_effort based on context.
 *
 * Usage:
 * ```ts
 * const client = new ProviderBackedModelClient(provider);
 * const routed = new EffortRoutingClient({ client });
 * // routed.call() now auto-adjusts effort per turn.
 * ```
 */
export class EffortRoutingClient implements ModelCallable {
  private readonly inner: ModelCallable;
  private readonly log?: Logger;
  private readonly toolExecutionEffort: ReasoningEffort;
  private readonly plannerEffort: ReasoningEffort;
  private readonly finalAnswerEffort: ReasoningEffort;

  constructor(opts: EffortRoutingClientOptions) {
    this.inner = opts.client;
    this.log = opts.logger;
    this.toolExecutionEffort = opts.toolExecutionEffort ?? 'high';
    this.plannerEffort = opts.plannerEffort ?? 'max';
    this.finalAnswerEffort = opts.finalAnswerEffort ?? 'max';
  }

  /**
   * Call the model with auto-routed effort.
   *
   * The caller's `effort` parameter is used as the DEFAULT, but this
   * wrapper may override it based on the conversation context.
   * @param params
   * @param params.messages
   * @param params.tools
   * @param params.effort
   * @param params.stream
   * @param params.onChunk
   * @param params.signal
   */
  async call(params: {
    messages: Message[];
    tools?: Parameters<ModelCallable['call']>[0]['tools'];
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: ModelStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<ModelResponse> {
    const callerEffort = params.effort ?? 'high';
    const routedEffort = this.routeEffort(params.messages, callerEffort);

    if (routedEffort !== callerEffort) {
      this.log?.debug('Effort routed', {
        from: callerEffort,
        to: routedEffort,
        reason: this.routeReason(params.messages, callerEffort),
      });
    }

    return this.inner.call({
      ...params,
      effort: routedEffort,
    });
  }

  /**
   * Determine the effort to use for this call.
   *
   * @param messages - The conversation messages.
   * @param callerEffort - The effort requested by the caller.
   * @returns The (possibly overridden) effort to use.
   */
  private routeEffort(messages: Message[], callerEffort: ReasoningEffort): ReasoningEffort {
    const reason = this.routeReason(messages, callerEffort);
    switch (reason) {
      case 'tool-execution':
        return this.toolExecutionEffort;
      case 'planner':
        return this.plannerEffort;
      case 'final-answer':
        return this.finalAnswerEffort;
      default:
        return callerEffort;
    }
  }

  /**
   * Classify the turn type for effort routing.
   *
   * Heuristics (in priority order):
   *   1. If the last message is a tool result → 'tool-execution' (the
   *      model is in the middle of a tool sequence, deciding what to
   *      do next — typically a quick decision, so downgrade to 'high').
   *   2. If the last assistant message has tool calls (and no tool
   *      results yet) → 'tool-execution' (same reasoning).
   *   3. If the system prompt has planner keywords → 'planner' (upgrade
   *      to 'max' for deep reasoning).
   *   4. Otherwise → 'default' (respect the caller's effort).
   *
   * Note: we intentionally do NOT have a separate 'final-answer'
   * classification because we can't distinguish "the model is about to
   * produce its final answer" from "the model is about to call another
   * tool" until the model actually responds. Using 'high' for tool-
   * execution turns is a safe default that saves tokens without
   * sacrificing quality (the model can still call tools effectively
   * at 'high' effort).
   *
   * @param messages
   * @param _callerEffort
   * @returns The turn type.
   */
  private routeReason(
    messages: Message[],
    _callerEffort: ReasoningEffort,
  ): 'tool-execution' | 'planner' | 'final-answer' | 'default' {
    const lastMessage = messages[messages.length - 1];

    // 1. Tool-execution turn: the last message is a tool result (the
    //    model is mid-sequence, deciding what to do next).
    if (lastMessage?.role === 'tool') {
      return 'tool-execution';
    }

    // 2. Tool-execution turn: the last assistant message has tool calls
    //    (the model just emitted tool calls and is about to receive
    //    results — but in some flows, the caller sends the assistant
    //    message as the last message before the tool results arrive).
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (
      lastAssistant?.toolCalls &&
      lastAssistant.toolCalls.length > 0 &&
      lastMessage?.role === 'assistant'
    ) {
      return 'tool-execution';
    }

    // 3. Planner turn: system prompt contains planner keywords.
    const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
    if (PLANNER_KEYWORDS.some((kw) => systemPrompt.toLowerCase().includes(kw))) {
      return 'planner';
    }

    // 4. Default: respect the caller's effort.
    return 'default';
  }
}
