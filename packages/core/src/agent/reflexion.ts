/**
 * Reflexion engine (Module 1, next-gen cognitive layer).
 *
 * Implements the Reflexion pattern (Shinn et al., 2023): when the agent
 * encounters a structural failure (not a transient retry), it pauses,
 * verbally reflects on *why* the failure occurred, and stores the
 * reflection in episodic memory for subsequent attempts.
 *
 * This turns a hard failure into a learning step. Instead of blindly
 * retrying or giving up, the agent generates a natural-language
 * reflection like:
 *
 *   "The edit_file tool failed because old_string wasn't unique.
 *    I should use read_file first to get more surrounding context
 *    and provide a longer, unique old_string."
 *
 * The reflection is injected into the next system-prompt assembly cycle
 * so the model adapts its strategy.
 *
 * ## Integration with the agent loop (P2-18 — wired)
 *
 * `AgentLoop` instantiates a `ReflexionEngine` in its constructor (or
 * accepts a caller-provided one via `AgentLoopOptions.reflexionEngine`).
 * After each tool-call failure, `AgentLoop.executeToolCall()` calls
 * `reflexionEngine.reflect()` with the error, the failed `ToolCall`,
 * the structured `ClassifiedError` (from `error-classifier.ts`), and
 * the recent conversation messages. The engine:
 *   1. Constructs a reflection prompt with the error and recent context.
 *   2. Calls the LLM (with `effort: 'high'` — reflection doesn't need max).
 *      When no LLM client is configured, falls back to a heuristic
 *      reflection that maps the error category to a pre-written strategy.
 *   3. Stores the reflection in the episodic memory buffer.
 *   4. Returns the reflection (the loop ignores the return value — the
 *      side-effect of storing it in the engine is what matters).
 *
 * On the next iteration, `AgentLoop.run()` calls
 * `reflexionEngine.formatForPrompt()` and passes the resulting string
 * to the system-prompt assembler as `ctx.reflections`. The assembler
 * renders it as a "Recent Reflections (lessons from failures)" fragment
 * so the model adapts its strategy on subsequent turns.
 *
 * @module agent/reflexion
 */

import type { ClassifiedError } from './error-classifier.js';
import type { Message, ToolCall } from './types.js';
import type { Logger } from '../utils/logger.js';

/** A single reflection entry in episodic memory. */
export interface Reflection {
  /** When the reflection was generated (ISO 8601). */
  timestamp: string;
  /** The error that triggered the reflection. */
  error: string;
  /** The tool call that failed. */
  toolCall: ToolCall;
  /** The classification of the error. */
  errorCategory: ClassifiedError['reason'];
  /** The agent's verbal reflection on the failure. */
  reflection: string;
  /** The suggested strategy change. */
  strategy: string;
}

/** Options for the ReflexionEngine. */
export interface ReflexionEngineOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The LLM client to use for generating reflections. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
  /** Maximum reflections to retain in episodic memory (default: 10). */
  maxReflections?: number;
}

const REFLECTION_PROMPT = `You are reflecting on a tool-call failure. Analyze WHY the failure occurred and propose a STRATEGY CHANGE for the next attempt.

Failure context:
- Tool: {tool_name}
- Error: {error_message}
- Error category: {error_category}
- Arguments: {tool_args}

Recent conversation (last 3 messages):
{recent_context}

Generate a JSON response with two fields:
{
  "reflection": "A brief analysis of why this failed and what went wrong.",
  "strategy": "A concrete strategy change for the next attempt (e.g., 'Read the file first to get unique context' or 'Use a more specific pattern')."
}

Be concise. The reflection should be 1-2 sentences. The strategy should be actionable.`;

/**
 * The ReflexionEngine — verbal self-reflection on structural failures.
 *
 * Usage:
 * ```ts
 * const engine = new ReflexionEngine({ llmClient: client });
 * const reflection = await engine.reflect(error, toolCall, classification, messages);
 * // reflection.reflection = "The old_string wasn't unique..."
 * // reflection.strategy = "Read the file first to get more context"
 * ```
 */
export class ReflexionEngine {
  private readonly log?: Logger;
  private readonly llmClient?: ReflexionEngineOptions['llmClient'];
  private readonly maxReflections: number;
  private readonly reflections: Reflection[] = [];

  constructor(opts: ReflexionEngineOptions = {}) {
    this.log = opts.logger;
    this.llmClient = opts.llmClient;
    this.maxReflections = opts.maxReflections ?? 10;
  }

  /**
   * Generate a reflection on a structural failure.
   *
   * @param error - The error that occurred.
   * @param toolCall - The tool call that failed.
   * @param classification - The structured error classification.
   * @param recentMessages - The recent conversation messages (for context).
   * @returns The reflection, or null if no LLM client is available.
   */
  async reflect(
    error: unknown,
    toolCall: ToolCall,
    classification: ClassifiedError,
    recentMessages: Message[],
  ): Promise<Reflection | null> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCategory = classification.reason;

    // If no LLM client, use a heuristic reflection.
    if (!this.llmClient) {
      return this.heuristicReflection(error, toolCall, classification);
    }

    const recentContext = recentMessages
      .slice(-3)
      .map((m) => `[${m.role}] ${m.content.slice(0, 200)}`)
      .join('\n');

    const prompt = REFLECTION_PROMPT
      .replace('{tool_name}', toolCall.name)
      .replace('{error_message}', errorMessage.slice(0, 500))
      .replace('{error_category}', errorCategory)
      .replace('{tool_args}', toolCall.arguments.slice(0, 300))
      .replace('{recent_context}', recentContext);

    try {
      const response = await this.llmClient.call({
        messages: [
          { role: 'system', content: 'You are a debugging assistant that analyzes tool-call failures.', timestamp: new Date().toISOString() },
          { role: 'user', content: prompt, timestamp: new Date().toISOString() },
        ],
        effort: 'high',
      });

      const parsed = this.parseReflectionResponse(response.content);
      const reflection: Reflection = {
        timestamp: new Date().toISOString(),
        error: errorMessage,
        toolCall,
        errorCategory,
        reflection: parsed.reflection,
        strategy: parsed.strategy,
      };

      this.addReflection(reflection);
      this.log?.info('Reflection generated', {
        tool: toolCall.name,
        errorCategory,
        strategy: parsed.strategy.slice(0, 100),
      });

      return reflection;
    } catch (err) {
      this.log?.warn('Reflection LLM call failed, using heuristic', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.heuristicReflection(error, toolCall, classification);
    }
  }

  /**
   * Get all stored reflections (for injection into the next prompt).
   */
  getReflections(): Reflection[] {
    return [...this.reflections];
  }

  /**
   * Format reflections for system-prompt injection.
   *
   * @returns A string summarizing recent reflections, or empty if none.
   */
  formatForPrompt(): string {
    if (this.reflections.length === 0) return '';
    const lines: string[] = ['## Recent Reflections (lessons from failures)'];
    for (const r of this.reflections.slice(-3)) {
      lines.push(`- [${r.errorCategory}] ${r.strategy}`);
    }
    return lines.join('\n');
  }

  /**
   * Clear all reflections (for session reset).
   */
  clear(): void {
    this.reflections.length = 0;
  }

  // ─── Internal helpers ──────────────────────────────────────────

  private addReflection(reflection: Reflection): void {
    this.reflections.push(reflection);
    while (this.reflections.length > this.maxReflections) {
      this.reflections.shift();
    }
  }

  private parseReflectionResponse(content: string): { reflection: string; strategy: string } {
    // Try JSON parse.
    try {
      const match = content.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { reflection?: string; strategy?: string };
        return {
          reflection: parsed.reflection ?? content.slice(0, 200),
          strategy: parsed.strategy ?? content.slice(0, 200),
        };
      }
    } catch {
      // Fall through.
    }
    // Fallback: use the raw content as both.
    return {
      reflection: content.slice(0, 200),
      strategy: content.slice(0, 200),
    };
  }

  /**
   * Generate a heuristic reflection without an LLM (fallback).
   *
   * Maps common error categories to pre-written strategies.
   * @param error
   * @param toolCall
   * @param classification
   */
  private heuristicReflection(
    error: unknown,
    toolCall: ToolCall,
    classification: ClassifiedError,
  ): Reflection {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const strategies: Record<string, string> = {
      auth: 'The API key may be invalid. Check GOLI_MODEL_API_KEY and try again.',
      rate_limit: 'Rate limited. Wait before retrying or rotate credentials.',
      context_too_long: 'Context is too long. Use /compact to reduce context size.',
      tool_validation: `The ${toolCall.name} tool received invalid arguments. Check the schema and try again.`,
      tool_execution: `The ${toolCall.name} tool failed. Read the error message carefully and try a different approach.`,
      network: 'Network error. Check connectivity and retry.',
      unknown: `The ${toolCall.name} tool failed unexpectedly. Try a different approach or tool.`,
    };

    const strategy = strategies[classification.reason] ?? strategies['unknown']!;
    const reflection = `The ${toolCall.name} call failed with: ${errorMessage.slice(0, 150)}`;

    const result: Reflection = {
      timestamp: new Date().toISOString(),
      error: errorMessage,
      toolCall,
      errorCategory: classification.reason,
      reflection,
      strategy,
    };

    this.addReflection(result);
    return result;
  }
}
