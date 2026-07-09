/**
 * ReAct master loop (Module 1).
 *
 * The single-threaded master loop that powers every agent in the 11-agent
 * swarm. Each iteration:
 *
 * 1. **Pre-check + compaction** — check budget; if context > 70%, compact
 *    (Phase 7 implements compaction; Phase 2 is a no-op stub)
 * 2. **Assemble system prompt** — from 9 conditional fragments
 * 3. **Call model** — with streaming, tools, and reasoning effort
 * 4. **Parse response** — content, thinking, tool calls (defensive JSON)
 * 5. **Check stop conditions** — natural completion / budget / stall / error
 * 6. **Execute tool calls** — dispatch to tool registry (Phase 4 implements
 *    the registry; Phase 2 stubs tool execution with a "not implemented" result)
 * 7. **Append results to conversation** — for the next iteration's context
 * 8. **Update budget + stall detector** — record tokens, tool calls
 *
 * The loop is an async generator that yields {@link AgentEvent}s. The TUI
 * (Phase 3) and the CLI consume these to render streaming output.
 *
 * ## Phase 2 Status
 *
 * Phase 2 implements the loop with:
 * - ✅ Streaming model client
 * - ✅ Dynamic system prompt assembler
 * - ✅ TODO/planner engine
 * - ✅ Budget tracker (4 dimensions)
 * - ✅ Stall detector
 * - ✅ Retry with jittered backoff
 * - ✅ 4-condition stop engine
 * - ⏳ Tool execution (STUB — Phase 4 implements the tool registry)
 * - ⏳ Compaction (STUB — Phase 7 implements the context engine)
 *
 * @module agent/loop
 */

import { resolve } from 'node:path';

import { type ToolRegistry, createDefaultToolRegistry, toToolDefinition } from '../tools/index.js';
import { executeToolCallsConcurrent } from '../tools/parallel-execution.js';

import { AdvancedCompressor } from './advanced-compression.js';
import { BudgetTracker } from './budget.js';
import { type CredentialPool } from './credential-pool.js';
import { LoopDetector } from './loop-detector.js';
import { Planner, PLAN_TASK_TOOL } from './planner.js';
import { ProviderBackedModelClient, createProviderBackedClientSync } from './provider-adapter.js';
import { callWithRetry } from './retry.js';
import { StallDetector } from './stall-detector.js';
import { StopEngine } from './stop-engine.js';
import { SystemPromptAssembler } from './system-prompt.js';
import { ToolGuardrailController } from './tool-guardrails.js';
import { ToolsetSnapshot } from './toolset-snapshot.js';
import { OllamaProvider } from '../providers/ollama.js';

import type {
  Message,
  ToolCall,
  Todo,
  ConversationState,
  AgentEvent,
  AgentRole,
} from './types.js';
import type { AppConfig, ReasoningEffort } from '../config/schema.js';
import type { ToolContext } from '../tools/index.js';
import type { ToolDefinition } from '../tools/types.js';
import type { Logger } from '../utils/logger.js';

/**
 * Minimal interface the agent loop needs from a model client.
 * Any provider adapter or direct provider wrapper can satisfy this.
 */
interface ModelClient {
  call(params: {
    messages: Message[];
    tools?: ToolDefinition[];
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: unknown) => void;
    signal?: AbortSignal;
  }): Promise<{
    content: string;
    thinking: string;
    toolCalls: ToolCall[];
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    finishReason: string;
  }>;
  markCredentialError?(error: unknown): void;
}

/** Options for constructing an {@link AgentLoop}. */
export interface AgentLoopOptions {
  /** The loaded and validated app config. */
  config: AppConfig;
  /** Logger instance. */
  logger: Logger;
  /** Whether --god mode is active (bypasses safety). */
  godMode?: boolean;
  /** Whether --auto mode is active (auto-approve Tier 2 actions). */
  autoMode?: boolean;
  /** Override reasoning effort for this run. */
  effortOverride?: ReasoningEffort;
  /** Override model ID for this run. */
  modelOverride?: string;
  /**
   * Optional credential pool for multi-key failover (H3).
   *
   * When provided, the provider draws API keys from the pool instead
   * of the static config key. On 429/402 errors, the retry layer
   * automatically rotates to the next available key.
   */
  credentialPool?: CredentialPool;
}

/** Input to a single agent run. */
export interface AgentLoopInput {
  /** The user's prompt. */
  prompt: string;
  /** The agent role (Phase 2: always 'orchestrator'). */
  role?: AgentRole;
  /** Abort signal (for cancellation). */
  signal?: AbortSignal;
}

/** Result of a single agent run. */
export interface AgentLoopResult {
  /** Whether the run completed without errors. */
  ok: boolean;
  /** Why the run stopped. */
  stopReason?: 'completed' | 'budget' | 'stall' | 'error' | 'aborted' | 'not-implemented' | 'loop_detected';
  /** Final assistant content (concatenated from all iterations). */
  content: string;
  /** Total tokens consumed (input + output + thinking). */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Number of iterations completed. */
  iterations: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Final TODO list. */
  todos: Todo[];
  /** Error message (if `ok` is false). */
  error?: string;
}

/**
 * The agent loop — a single-threaded ReAct master loop.
 *
 * Usage:
 * ```ts
 * const loop = new AgentLoop({ config, logger });
 * const result = await loop.run({ prompt: 'Fix the bug in parser.ts' });
 * console.log(result.content);
 * ```
 */
export class AgentLoop {
  private readonly config: AppConfig;
  private readonly log: Logger;
  private readonly godMode: boolean;
  private readonly autoMode: boolean;
  private readonly effort: ReasoningEffort;
  private readonly client: ModelClient;
  private readonly assembler: SystemPromptAssembler;
  private readonly planner: Planner;
  private readonly budget: BudgetTracker;
  private readonly stallDetector: StallDetector;
  private readonly toolRegistry: ToolRegistry;
  private readonly compressor: AdvancedCompressor;
  /** Tool-call loop guardrails (H8) — detects exact-failure, same-tool-failure, and no-progress loops. */
  private readonly guardrails: ToolGuardrailController;
  /** T-065: Loop detector — catches repeated identical tool calls / content outputs. */
  private readonly loopDetector: LoopDetector;
  /** Flag set by the retry callback when the error classifier says context is too long. */
  private forceCompaction = false;
  private stopEngine?: StopEngine;
  // Per-run abort controller. A fresh one is created at the top of each
  // `run()` so that aborting one run does not poison subsequent runs
  // (the previous implementation shared a single controller across all
  // runs, which made the loop a no-op after the first abort).
  private currentAbortController?: AbortController;

  constructor(opts: AgentLoopOptions) {
    this.config = opts.config;
    this.log = opts.logger;
    this.godMode = opts.godMode ?? false;
    this.autoMode = opts.autoMode ?? false;
    this.effort = opts.effortOverride ?? opts.config.model.defaultEffort;

    const syncClient = createProviderBackedClientSync();
    this.client = syncClient ?? new ProviderBackedModelClient(
      new OllamaProvider({
        apiKey: process.env.OLLAMA_API_KEY || '',
        model: process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud',
        baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
      }),
    );

    this.assembler = new SystemPromptAssembler();
    this.planner = new Planner();
    this.budget = new BudgetTracker(opts.config.budget);
    this.stallDetector = new StallDetector(opts.config.stall);
    this.toolRegistry = createDefaultToolRegistry({ logger: this.log });
    // Wire H5 (advanced compression) into the live loop. The compressor's
    // in-loop trigger fires at 50% of context; the safety-net at 85%.
    this.compressor = new AdvancedCompressor({
      logger: this.log,
      glmClient: this.client as unknown as AdvancedCompressor['glmClient'] extends infer T ? T : never,
    });
    // Wire H8 (tool-call loop guardrails) into the live loop. The controller
    // detects exact-failure loops (same tool + same args + failure), same-tool-
    // failure loops (same tool, different args, but always failing), and
    // no-progress loops (mutating tools that don't change the working tree).
    // Previously this module was exported but never consumed by the loop.
    this.guardrails = new ToolGuardrailController();
    // T-065: Wire the LoopDetector into the loop. Resets per-run, detects
    // consecutive identical tool calls (threshold 5) and content outputs
    // (threshold 10). On detection, logs a warning + breaks the loop.
    this.loopDetector = new LoopDetector({
      onLoopDetected: (event) => {
        this.log.warn('Loop detected — breaking agent loop', {
          type: event.type,
          count: event.count,
          threshold: event.threshold,
          description: event.description,
        });
      },
    });
  }

  /**
   * Run the agent loop with a single prompt.
   *
   * @param input
   * @returns The run result.
   */
  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const startedAt = Date.now();
    const role: AgentRole = input.role ?? 'orchestrator';

    // Fresh AbortController per run. Sharing one across runs meant that
    // after the first abort, every subsequent run was a no-op.
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    // Honor external abort signal — and clean up the listener on exit
    // so that repeated runs with the same signal don't accumulate listeners.
    let externalAbortListener: (() => void) | undefined;
    if (input.signal) {
      if (input.signal.aborted) {
        abortController.abort();
      } else {
        externalAbortListener = () => abortController.abort();
        input.signal.addEventListener('abort', externalAbortListener, { once: true });
      }
    }

    this.log.info('Agent loop starting', {
      role,
      prompt: input.prompt.slice(0, 100),
      effort: this.effort,
      godMode: this.godMode,
    });

    this.stopEngine = new StopEngine(this.budget, this.stallDetector, this.config.stall);

    // Build initial conversation state
    const state: ConversationState = {
      messages: [],
      role,
      todos: [],
      readFiles: new Set(),
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      iterations: 0,
      startedAt: new Date().toISOString(),
      recentToolCallSignatures: [],
    };

    // Add the user's prompt as the first user message
    state.messages.push({
      role: 'user',
      content: input.prompt,
      timestamp: new Date().toISOString(),
    });

    // T-065: Reset the loop detector at the start of each run so that
    // counters from a previous run don't carry over.
    this.loopDetector.reset();

    // Available tools: plan_task + all registered core tools (Phase 4).
    //
    // T-021 (per-conversation prompt caching invariant): the tool list is
    // snapshotted ONCE at conversation start and reused for every turn.
    // This preserves the byte-stable system prompt required for provider-
    // side prompt caching. If a tool's check_fn flips mid-conversation
    // (e.g. an LSP server starts), the change is deferred to the next
    // conversation by default. The user can opt in to immediate
    // invalidation via a slash command with --now (calls
    // toolsetSnapshot.invalidate()).
    const toolsetSnapshot = new ToolsetSnapshot([
      PLAN_TASK_TOOL as ToolDefinition,
      ...this.toolRegistry.list().map((t) => toToolDefinition(t)),
    ]);
    const availableTools: ToolDefinition[] = [...toolsetSnapshot.getTools()];

    // The loop
    let lastAssistantContent = '';
    let stopReason: AgentLoopResult['stopReason'] | undefined;

    try {
      // Belt-and-suspenders hard cap: never exceed maxIterations + 5,
      // even if StopEngine has a bug that prevents it from firing.
      const hardCap = this.config.budget.maxIterations + 5;
      for (let safetyIter = 0; safetyIter < hardCap; safetyIter++) {
        // ─── 0. Check abort ────────────────────────────────────
        if (abortController.signal.aborted) {
          stopReason = 'aborted';
          break;
        }

        // ─── 1. Pre-check + compaction (H5: advanced compression) ──
        // Compaction triggers when:
        //   - Token usage exceeds 50% of the context window (in-loop trigger), OR
        //   - The retry layer set `forceCompaction` (the error classifier
        //     detected a "context too long" error from the model API).
        const maxContextTokens = this.config.model.maxContextTokens;
        const currentTokens = this.budget.snapshot().totalTokens;
        const shouldCompact = currentTokens > Math.floor(maxContextTokens * 0.5) || this.forceCompaction;
        if (shouldCompact) {
          this.forceCompaction = false; // Reset the flag.
          try {
            const compaction = await this.compressor.compress(
              state.messages,
              currentTokens,
              maxContextTokens,
            );
            if (compaction.tokensSaved > 0) {
              state.messages = compaction.messages;
              this.log.info('In-loop compaction', {
                trigger: compaction.triggerPhase,
                tokensBefore: compaction.tokensBefore,
                tokensAfter: compaction.tokensAfter,
                tokensSaved: compaction.tokensSaved,
                pruned: compaction.prunedCount,
              });
            }
          } catch (err) {
            this.log.warn('Compaction failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // ─── 2. Assemble system prompt ────────────────────────
        const systemPrompt = this.assembler.assemble({
          role: state.role,
          toolNames: availableTools.map((t) => t.function.name),
          sandboxMode: this.config.sandbox.mode,
          todos: this.planner.getTodos(),
          language: 'English',
          godMode: this.godMode,
          taskPrompt: input.prompt,
        });

        // Build the messages array for the API call
        const apiMessages: Message[] = [
          { role: 'system', content: systemPrompt, timestamp: new Date().toISOString() },
          ...state.messages,
        ];

        // ─── 3. Call the model (with retry) ────────────────────
        this.log.debug('Calling model', {
          iteration: state.iterations + 1,
          messageCount: apiMessages.length,
          toolCount: availableTools.length,
        });

        let response;
        try {
          response = await callWithRetry(
            () =>
              this.client.call({
                messages: apiMessages,
                tools: availableTools,
                effort: this.effort,
                stream: this.config.model.streaming,
                signal: abortController.signal,
              }),
            {
              logger: this.log,
              // H3: the onRetry callback now receives the structured
              // ClassifiedError, which tells us whether to rotate
              // credentials (429/402) or compress context (context-too-long).
              onRetry: (_attempt, _delay, error, classification) => {
                if (classification?.shouldRotateCredential) {
                  // Mark the current credential as errored so the pool
                  // rotates to the next key on the next call.
                  this.client.markCredentialError?.(error);
                }
                if (classification?.shouldCompress) {
                  // Force compaction on the next iteration — the context
                  // is too long for the model's window.
                  this.log?.warn('Context too long — forcing compaction on next iteration', {
                    reason: classification.reason,
                  });
                  // We can't compact here (we're in the retry callback),
                  // but we set a flag that the next loop iteration checks.
                  this.forceCompaction = true;
                }
              },
            },
            this.config.retry,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.error('Model call failed', { error: message });
          stopReason = 'error';
          lastAssistantContent = `Error: ${message}`;
          break;
        }

        // ─── 4. Record tokens + budget ────────────────────────
        this.budget.recordCall(
          response.inputTokens,
          response.outputTokens,
          response.thinkingTokens,
        );
        state.inputTokens += response.inputTokens;
        state.outputTokens += response.outputTokens;
        state.thinkingTokens += response.thinkingTokens;

        // ─── 5. Check for parse failures ──────────────────────
        const parseFailures = response.toolCalls.filter((tc) => tc.parseError).length;
        if (parseFailures > 0) {
          for (let i = 0; i < parseFailures; i++) {
            this.stopEngine.recordParseFailure();
          }
          this.log.warn('Tool-call parse failures', { count: parseFailures });
        } else {
          this.stopEngine.resetParseFailures();
        }

        // ─── 6. Check stop conditions ─────────────────────────
        const stopResult = this.stopEngine.check(response);
        if (stopResult.shouldStop) {
          stopReason = stopResult.reason;
          if (response.content) lastAssistantContent = response.content;
          this.log.info('Agent loop stopping', {
            reason: stopResult.reason,
            message: stopResult.message,
            iterations: state.iterations,
            tokens: this.budget.snapshot().totalTokens,
          });
          break;
        }

        // ─── 7. Append assistant message to conversation ──────
        const assistantMessage: Message = {
          role: 'assistant',
          content: response.content,
          thinking: response.thinking,
          toolCalls: response.toolCalls,
          timestamp: new Date().toISOString(),
        };
        state.messages.push(assistantMessage);
        if (response.content) lastAssistantContent = response.content;

        // T-065: Check for content loop (repeated identical assistant content).
        if (response.content) {
          const contentLoop = this.loopDetector.recordContent(response.content);
          if (contentLoop) {
            stopReason = 'loop_detected';
            this.log.warn('Content loop detected — stopping agent loop', {
              count: contentLoop.event.count,
              threshold: contentLoop.event.threshold,
            });
            break;
          }
        }

        // T-065: Check for tool-call loop (repeated identical tool calls).
        if (response.toolCalls.length > 0) {
          let toolLoop = null;
          for (const tc of response.toolCalls) {
            toolLoop = this.loopDetector.recordToolCall({
              name: tc.name,
              args: tc.argumentsParsed ?? tc.arguments,
            });
            if (toolLoop) break;
          }
          if (toolLoop) {
            stopReason = 'loop_detected';
            this.log.warn('Tool-call loop detected — stopping agent loop', {
              count: toolLoop.event.count,
              threshold: toolLoop.event.threshold,
              description: toolLoop.event.description,
            });
            break;
          }
        }

        // ─── 8. Execute tool calls (H4: parallel + H8: guardrails) ──────
        // The model can emit multiple tool calls per turn. Read-only tools
        // (read_file, grep, list_directory) and non-overlapping file-mutating
        // tools (write_file/edit_file on distinct paths) run in parallel.
        // Interactive/side-effecting tools (bash, plan_task) run sequentially.
        //
        // Before executing, check the H8 ToolGuardrailController for loop
        // detection (exact-failure, same-tool-failure, no-progress). If a
        // guardrail fires, we inject a synthetic tool result telling the
        // model to stop repeating the same failing action.
        const guardrailDecisions = new Map<string, { blocked: boolean; reason?: string; syntheticResult?: string }>();
        for (const tc of response.toolCalls) {
          const decision = this.guardrails.check(tc, false);
          // 'halt' and 'inject_result' both prevent execution; 'inject_result'
          // also provides a synthetic message to show the model.
          if (decision.action === 'halt' || decision.action === 'inject_result') {
            guardrailDecisions.set(tc.id, {
              blocked: true,
              reason: decision.reason,
              syntheticResult: decision.syntheticResult,
            });
          }
        }

        // Separate blocked calls from executable calls.
        const executableCalls = response.toolCalls.filter((tc) => !guardrailDecisions.has(tc.id));

        // Execute the non-blocked calls in parallel.
        const toolExecResults = executableCalls.length > 0
          ? await executeToolCallsConcurrent(
              executableCalls,
              (tc) => this.executeToolCall(tc, state),
              abortController.signal,
            )
          : [];

        // Append results for both executed and blocked calls.
        for (const toolCall of response.toolCalls) {
          const guardrail = guardrailDecisions.get(toolCall.id);
          if (guardrail) {
            // Guardrail blocked this call — inject synthetic result.
            const syntheticContent = guardrail.syntheticResult
              ?? `[GUARDRAIL] ${guardrail.reason ?? 'Tool call blocked by loop guardrail. Stop repeating the same failing action and try a different approach.'}`;
            state.messages.push({
              role: 'tool',
              content: syntheticContent,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              timestamp: new Date().toISOString(),
            });
            continue;
          }
          const execResult = toolExecResults.find((r) => r.toolCall.id === toolCall.id);
          if (execResult) {
            const { ok, result, error } = execResult;
            const toolResult = ok
              ? (result as string)
              : `Error: ${error ?? 'tool execution failed'}`;
            // Record the result with the guardrails (for success/failure tracking).
            this.guardrails.check(toolCall, ok);
            state.messages.push({
              role: 'tool',
              content: toolResult,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // ─── 9. Record iteration + reset stall if progress ────
        this.budget.recordIteration();
        state.iterations++;
        // Reset stall detector on successful progress (any non-parse-failed
        // tool call OR no tool calls at all means the model produced output).
        if (parseFailures === 0) {
          this.stallDetector.reset();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('Agent loop crashed', { error: message });
      stopReason = 'error';
      lastAssistantContent = `Error: ${message}`;
    } finally {
      // Clean up the external abort listener to prevent accumulation
      // across multiple runs sharing the same signal.
      if (input.signal && externalAbortListener) {
        input.signal.removeEventListener('abort', externalAbortListener);
      }
      this.currentAbortController = undefined;
    }

    const durationMs = Date.now() - startedAt;
    const budgetSnap = this.budget.snapshot();

    return {
      ok: stopReason === 'completed',
      stopReason,
      content: lastAssistantContent,
      totalTokens: budgetSnap.totalTokens,
      totalCostUsd: budgetSnap.totalCostUsd,
      iterations: budgetSnap.iterations,
      durationMs,
      todos: this.planner.getTodos(),
      error: stopReason === 'error' ? lastAssistantContent : undefined,
    };
  }

  /**
   * Execute a single tool call.
   *
   * Phase 4: `plan_task` is handled inline (it updates the planner).
   * All other tools are dispatched through the ToolRegistry, which
   * handles JSON Schema validation, execution, and truncation.
   * @param toolCall
   * @param state
   */
  private async executeToolCall(
    toolCall: ToolCall,
    state: ConversationState,
  ): Promise<string> {
    toolCall.status = 'executing';
    const startTime = Date.now();

    try {
      // Handle parse errors first
      if (toolCall.parseError) {
        toolCall.status = 'failed';
        toolCall.error = toolCall.parseError;
        return `Error: failed to parse tool arguments — ${toolCall.parseError}. Please re-emit the tool call with valid JSON.`;
      }

      const args = toolCall.argumentsParsed ?? {};

      // plan_task is handled inline (not in the registry)
      if (toolCall.name === 'plan_task') {
        const todos = args['todos'];
        if (!Array.isArray(todos)) {
          toolCall.status = 'failed';
          return 'Error: plan_task requires a "todos" array.';
        }
        try {
          this.planner.updateTodos(todos as Todo[]);
          toolCall.status = 'completed';
          return `TODO list updated. ${this.planner.summarize()}`;
        } catch (err) {
          toolCall.status = 'failed';
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // All other tools: dispatch through the registry
      const ctx: ToolContext = {
        toolCallId: toolCall.id,
        workspaceRoot: process.cwd(),
        readFiles: state.readFiles,
        godMode: this.godMode,
        autoMode: this.autoMode,
        sandboxMode: this.config.sandbox.mode,
        logger: this.log,
      };

      const result = await this.toolRegistry.dispatch(toolCall, ctx);

      // Update the toolCall with the result
      toolCall.status = result.ok ? 'completed' : 'failed';
      toolCall.result = result.content;
      toolCall.error = result.error;
      toolCall.durationMs = Date.now() - startTime;

      // Track read files (for Read-before-Edit enforcement).
      // Use path.resolve() for portable, normalized path comparison so
      // that `./foo/../bar` and `bar` hash to the same key. The previous
      // implementation used string concatenation which (a) didn't handle
      // Windows drive letters, (b) couldn't normalize `..` segments,
      // (c) left unsafe `as string` casts on `unknown` args.
      if (toolCall.name === 'read_file' && result.ok && args['file_path']) {
        const filePath = String(args['file_path']);
        const resolvedPath = resolve(process.cwd(), filePath);
        state.readFiles.add(resolvedPath);
      }

      if (result.ok) {
        return result.content;
      } else {
        return `Error: ${result.error ?? 'tool execution failed'}`;
      }
    } finally {
      toolCall.durationMs = Date.now() - startTime;
    }
  }

  /**
   * Abort the running loop. If no run is in progress, this is a no-op
   * (previously it would set a shared controller to aborted, poisoning
   * all future runs).
   */
  abort(): void {
    this.currentAbortController?.abort();
    this.stopEngine?.abort();
  }

  /**
   * Stream events from the loop (async generator).
   *
   * The TUI consumes this to render streaming output. Currently yields
   * `loop-start` and `stop` events; per-iteration events (`thinking`,
   * `content-delta`, `tool-call-start`, `tool-call-result`) require
   * the model client to expose a streaming callback, which is on the H9
   * improvement roadmap.
   * @param input
   */
  async *runStream(input: AgentLoopInput): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    yield {
      type: 'loop-start',
      data: {
        type: 'loop-start',
        prompt: input.prompt,
        role: input.role ?? 'orchestrator',
      },
      timestamp: new Date().toISOString(),
      iteration: 0,
    };

    const result = await this.run(input);

    yield {
      type: 'stop',
      data: {
        type: 'stop',
        reason: result.stopReason ?? 'completed',
        message: result.error ?? 'Done',
      },
      timestamp: new Date().toISOString(),
      iteration: result.iterations,
    };

    // startTime is captured for future per-iteration timing events
    // (H9 callback streaming will emit 'loop-iteration' events with
    // elapsed-ms fields derived from this baseline).
    void startTime;
  }
}
