/**
 * Central tool registry (Module 3).
 *
 * The registry is the dispatch pipeline between the agent loop and the
 * individual tool handlers. Every tool call goes through:
 *
 *   1. JSON Schema validation (reject malformed args, return error to model)
 *   2. PreToolUse hooks (Phase 6: block_destructive, block_secrets, etc.)
 *   3. Tool handler execution
 *   4. PostToolUse hooks (Phase 6: auto_format, git_checkpoint, etc.)
 *   5. Result truncation (cap at 4000 tokens, add recovery hint)
 *
 * Phase 4 implements steps 1, 3, and 5. Phase 6 adds steps 2 and 4.
 *
 * @module tools/registry
 */

import { HookEngine, type HookEngineOptions } from './hooks/index.js';
import { validateToolArgs, formatValidationErrors } from './schema-validator.js';
import { truncateResult } from './truncation.js';

import type { Tool, ToolResult, ToolContext, ToolDefinition } from './types.js';
import type { ToolCall } from '../agent/types.js';
import type { Logger } from '../utils/logger.js';


/** Options for constructing a ToolRegistry. */
export interface ToolRegistryOptions {
  /** Logger instance (optional). */
  logger?: Logger;
  /** Override the max tool result tokens (default: 4000). */
  maxToolResultTokens?: number;
  /** Hook engine (optional; if not provided, hooks are not run). */
  hookEngine?: HookEngine;
  /** Hook engine options (used if hookEngine is not provided). */
  hookEngineOptions?: HookEngineOptions;
}

/**
 * The central tool registry. Holds all registered tools and dispatches
 * tool calls through the validation → hooks → execute → hooks → truncate pipeline.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly log?: Logger;
  private readonly maxToolResultTokens: number;
  private readonly hookEngine: HookEngine | null;
  /**
   * TTL cache for `check_fn` results. The previous implementation
   * called `tool.check_fn()` on EVERY dispatch (line 220) AND again
   * when `listAvailable` / `getAvailableToolDefinitions` built the
   * schema. Unlike `SelfRegisteringRegistry` which caches `check_fn`
   * for 30s, `ToolRegistry` had NO cache. If `check_fn` does an
   * expensive probe (e.g., spawning `jupyter --version`), every
   * dispatch paid the cost — and if `check_fn` had side effects
   * (e.g., incremented a counter), it was called twice per turn.
   * We now cache the boolean result for 30s per tool name.
   */
  private readonly checkFnCache = new Map<string, { value: boolean; expiresAt: number }>();
  private static readonly CHECK_FN_TTL_MS = 30_000;

  constructor(opts: ToolRegistryOptions = {}) {
    this.log = opts.logger;
    this.maxToolResultTokens = opts.maxToolResultTokens ?? 4000;
    // Use provided hook engine, or create one if options given, or null
    if (opts.hookEngine) {
      this.hookEngine = opts.hookEngine;
    } else if (opts.hookEngineOptions !== undefined) {
      this.hookEngine = new HookEngine(opts.hookEngineOptions);
    } else {
      this.hookEngine = null;
    }
  }

  /** Get the hook engine (if any). */
  getHookEngine(): HookEngine | null {
    return this.hookEngine;
  }

  /**
   * Probe `tool.check_fn` with a 30s TTL cache so the same probe
   * doesn't run twice in a single agent turn (once for schema gen,
   * once on dispatch). Returns `true` if the tool is currently
   * available. Throws are caught and treated as unavailable.
   */
  private async probeCheckFn(tool: Tool): Promise<boolean> {
    if (!tool.check_fn) return true;
    const now = Date.now();
    const cached = this.checkFnCache.get(tool.name);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    let available = true;
    try {
      available = Boolean(await tool.check_fn());
    } catch {
      available = false;
    }
    this.checkFnCache.set(tool.name, {
      value: available,
      expiresAt: now + ToolRegistry.CHECK_FN_TTL_MS,
    });
    return available;
  }

  /**
   * Register a tool. Throws if a tool with the same name is already
   * registered.
   * @param tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.log?.debug('Tool registered', { name: tool.name, tier: tool.tier ?? 'T1' });
  }

  /**
   * Check if a tool is registered.
   * @param name
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get a tool by name.
   * @param name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools. */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Get all registered tools whose `check_fn` (if any) currently passes.
   *
   * Tools without a `check_fn` are always included. Tools with a `check_fn`
   * are included iff the function returns (or resolves to) `true`.
   *
   * This is the canonical list to use when building the LLM's tool schema —
   * service-gated tools (Footprint Ladder rung 3) contribute zero schema
   * cost when their prerequisite is unmet.
   *
   * @returns A promise resolving to the list of available tools.
   */
  async listAvailable(): Promise<Tool[]> {
    const out: Tool[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.check_fn) {
        out.push(tool);
        continue;
      }
      try {
        // Call `tool.check_fn()` DIRECTLY — bypass the 30s TTL cache
        // used by `dispatch()`. The cache made `listAvailable` return
        // stale results when a `check_fn` probe flipped between calls
        // (e.g., a service became available mid-turn): the first
        // `listAvailable()` cached the (false) result, so subsequent
        // `listAvailable()` calls kept hiding the tool for up to 30s
        // even after the service came up. `dispatch()` still uses the
        // cache (so schema-gen + dispatch within a single turn avoid
        // double-probing).
        const ok = Boolean(await tool.check_fn());
        if (ok) out.push(tool);
      } catch (err) {
        // check_fn throwing ⇒ treat as unavailable; do not crash the loop.
        this.log?.warn('check_fn threw; treating as unavailable', {
          tool: tool.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  /**
   * Get all tool definitions in the OpenAI function-calling format.
   * Used to build the `tools` array sent to the model.
   *
   * NOTE: this method does NOT respect `check_fn`. It returns every
   * registered tool's definition. Use {@link getAvailableToolDefinitions}
   * for the service-gated variant.
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Get tool definitions for every tool whose `check_fn` (if any) currently
   * passes. This is the schema to send to the LLM — service-gated tools
   * (Footprint Ladder rung 3) are excluded when their prerequisite is
   * unmet, yielding zero permanent schema cost for opt-in capability.
   *
   * @returns A promise resolving to the available tool definitions.
   */
  async getAvailableToolDefinitions(): Promise<ToolDefinition[]> {
    const tools = await this.listAvailable();
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Dispatch a tool call through the full pipeline.
   *
   * @param toolCall - The tool call from the model.
   * @param context - The runtime context.
   * @returns The tool result (possibly truncated).
   */
  async dispatch(
    toolCall: ToolCall,
    context: ToolContext,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      // Compute the available tool list lazily — only on the error path —
      // so the happy path stays sync.
      const available = await this.listAvailable();
      return {
        toolCallId: toolCall.id,
        ok: false,
        content: '',
        error: `Unknown tool: ${toolCall.name}. Available tools: ${available
          .map((t) => t.name)
          .join(', ')}`,
        durationMs: Date.now() - startTime,
      };
    }

    // ─── 1. Check for parse errors ──────────────────────────────
    if (toolCall.parseError) {
      return {
        toolCallId: toolCall.id,
        ok: false,
        content: '',
        error: `Failed to parse tool arguments: ${toolCall.parseError}. Please re-emit the tool call with valid JSON.`,
        durationMs: Date.now() - startTime,
      };
    }

    // ─── 1b. check_fn gate (service-gated tools, T-020) ────────
    // Even if the model emits a call to a gated tool, refuse if the
    // prerequisite is currently unmet. (The tool should normally not
    // appear in the schema, but we defend-in-depth.) We use the
    // 30s TTL cache via `probeCheckFn` so the same probe doesn't
    // run twice in a single agent turn (once for schema gen, once
    // on dispatch).
    if (tool.check_fn) {
      const available = await this.probeCheckFn(tool);
      if (!available) {
        this.log?.warn('Refused tool call: check_fn returned false', {
          tool: toolCall.name,
        });
        return {
          toolCallId: toolCall.id,
          ok: false,
          content: '',
          error: `Tool "${toolCall.name}" is currently unavailable (prerequisite not configured). Use a different tool or configure the prerequisite and retry.`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    const args = toolCall.argumentsParsed ?? {};

    // ─── 2. JSON Schema validation ──────────────────────────────
    const validation = validateToolArgs(args, tool.inputSchema);
    if (!validation.ok) {
      const errorMsg = formatValidationErrors(validation.errors);
      this.log?.warn('Tool validation failed', {
        tool: toolCall.name,
        errors: validation.errors,
      });
      return {
        toolCallId: toolCall.id,
        ok: false,
        content: '',
        error: `Argument validation failed:\n${errorMsg}\n\nSchema: ${JSON.stringify(tool.inputSchema, null, 2)}`,
        durationMs: Date.now() - startTime,
      };
    }

    // ─── 3. PreToolUse hooks ────────────────────────────────────
    let effectiveArgs = args;
    if (this.hookEngine) {
      const preResult = await this.hookEngine.runPreToolUse({
        toolName: toolCall.name,
        toolCall,
        args,
        workspaceRoot: context.workspaceRoot,
        godMode: context.godMode,
        logger: this.log,
      });

      if (preResult.decision === 'deny') {
        this.log?.warn('Tool denied by PreToolUse hook', {
          tool: toolCall.name,
          reason: preResult.reason,
        });
        return {
          toolCallId: toolCall.id,
          ok: false,
          content: '',
          error: preResult.reason ?? 'Denied by safety hook',
          durationMs: Date.now() - startTime,
        };
      }

      if (preResult.decision === 'ask') {
        // Phase 6: return a "permission required" result
        // Phase 5's approval engine handles the actual dialog
        return {
          toolCallId: toolCall.id,
          ok: false,
          content: '',
          error: `Permission required: ${preResult.reason ?? 'PreToolUse hook requested approval'}`,
          durationMs: Date.now() - startTime,
        };
      }

      if (preResult.modifiedInput) {
        // Defense-in-depth: any input mutation by a hook must be re-validated
        // against the schema and re-checked against the safety hooks that
        // gate filesystem and command execution. Otherwise a plugin hook
        // with priority >= 40 can rewrite a path the earlier safety hooks
        // (block_destructive=10, block_secrets=20, block_writes_outside_workspace=30)
        // already approved, and the new path can escape the workspace.
        effectiveArgs = preResult.modifiedInput;

        const reValidation = validateToolArgs(effectiveArgs, tool.inputSchema);
        if (!reValidation.ok) {
          const reValidationMsg = formatValidationErrors(reValidation.errors);
          this.log?.warn('Hook-modified input failed validation', {
            tool: toolCall.name,
            errors: reValidation.errors,
          });
          return {
            toolCallId: toolCall.id,
            ok: false,
            content: '',
            error: `Hook-modified input failed validation: ${reValidationMsg}`,
            durationMs: Date.now() - startTime,
          };
        }

        // Re-run the PreToolUse safety hooks on the modified input so that
        // path/command safety is enforced on the *effective* args.
        const reSafety = await this.hookEngine.runPreToolUse({
          toolName: toolCall.name,
          toolCall,
          args: effectiveArgs,
          workspaceRoot: context.workspaceRoot,
          godMode: context.godMode,
          logger: this.log,
        });
        if (reSafety.decision === 'deny') {
          this.log?.warn('Hook-modified input denied by safety hook', {
            tool: toolCall.name,
            reason: reSafety.reason,
          });
          return {
            toolCallId: toolCall.id,
            ok: false,
            content: '',
            error: reSafety.reason ?? 'Modified input denied by safety hook',
            durationMs: Date.now() - startTime,
          };
        }
        if (reSafety.decision === 'ask') {
          return {
            toolCallId: toolCall.id,
            ok: false,
            content: '',
            error: `Permission required: ${reSafety.reason ?? 'Modified input requires approval'}`,
            durationMs: Date.now() - startTime,
          };
        }
        // If the safety re-run also returned a modifiedInput, prefer the
        // doubly-checked value. Do not recurse — a second mutation would
        // already have been validated by the safety hook pipeline itself.
        if (reSafety.modifiedInput) {
          effectiveArgs = reSafety.modifiedInput;
        }
      }
    }

    // ─── 4. Execute the tool handler ────────────────────────────
    let result: ToolResult;
    try {
      result = await tool.handler(effectiveArgs, {
        ...context,
        toolCallId: toolCall.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.error('Tool execution failed', { tool: toolCall.name, error: message });
      result = {
        toolCallId: toolCall.id,
        ok: false,
        content: '',
        error: `Tool execution failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }

    // ─── 5. PostToolUse hooks ───────────────────────────────────
    if (this.hookEngine) {
      const postResult = await this.hookEngine.runPostToolUse({
        toolName: toolCall.name,
        toolCall,
        args: effectiveArgs,
        result,
        workspaceRoot: context.workspaceRoot,
        godMode: context.godMode,
        logger: this.log,
      });

      if (postResult.feedback.length > 0) {
        result.content = (result.content ?? '') + '\n\n' + postResult.feedback.join('\n');
      }
    }

    // ─── 6. Truncate the result ─────────────────────────────────
    if (result.content && result.content.length > 0) {
      const truncation = truncateResult(result.content, this.maxToolResultTokens);
      result.content = truncation.content;
      result.truncated = truncation.truncated;
      result.totalTokens = truncation.totalTokens;
      if (truncation.truncated && truncation.hint) {
        result.content += `\n\n[${truncation.hint}]`;
      }
    }

    result.durationMs = result.durationMs ?? Date.now() - startTime;
    result.tier = result.tier ?? tool.tier ?? 'T1';

    this.log?.debug('Tool dispatched', {
      tool: toolCall.name,
      ok: result.ok,
      durationMs: result.durationMs,
      truncated: result.truncated,
    });

    return result;
  }
}
