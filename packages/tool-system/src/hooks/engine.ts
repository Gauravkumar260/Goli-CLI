/**
 * Hook engine (Module 3, part 2).
 *
 * The central dispatcher for PreToolUse, PostToolUse, UserPromptSubmit,
 * and Stop hooks. Hooks fire in priority order (lower = first). The
 * engine short-circuits on the first `deny` (PreToolUse) or `false`
 * (UserPromptSubmit).
 *
 * ## Integration with ToolRegistry
 *
 * The ToolRegistry calls the hook engine at two points:
 * 1. Before tool execution: `runPreToolUse()` — if any hook denies,
 *    the tool is not executed.
 * 2. After tool execution: `runPostToolUse()` — feedback is appended
 *    to the tool result.
 *
 * @module tools/hooks/engine
 */

import type { ToolResult } from '../types.js';
import type {
  Hook,
  HookEvent,
  HookContext,
  PreToolUseHookResult,
  PostToolUseHookResult,
  UserPromptSubmitHookResult,
  PreToolUseHandler,
  PostToolUseHandler,
  UserPromptSubmitHandler,
  SessionStartHandler,
  PreCompactHandler,
  StopHandler,
} from './types.js';
import type { ToolCall } from '@goli-cli/shared';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

// Re-export ToolCall and ToolResult for convenience (they're used in HookContext)
/**
 *
 */
export type { ToolCall, ToolResult };

/** Options for constructing a HookEngine. */
export interface HookEngineOptions {
  /** Logger instance (optional). */
  logger?: Logger;
}

/** Result of running all PreToolUse hooks for a tool call. */
export interface PreToolUseResult {
  /** The final decision: allow if all hooks allow, deny if any denies, ask if any asks (and none deny). */
  decision: 'allow' | 'deny' | 'ask';
  /** The reason from the deciding hook. */
  reason?: string;
  /** Modified input (if any hook rewrote it). */
  modifiedInput?: Record<string, unknown>;
  /** All hook results (for debugging). */
  hookResults: Array<{ name: string; result: PreToolUseHookResult }>;
}

/** Result of running all PostToolUse hooks. */
export interface PostToolUseResult {
  /** Combined feedback from all hooks. */
  feedback: string[];
  /** Whether any hook requested a re-run. */
  reRun: boolean;
  /** All hook results (for debugging). */
  hookResults: Array<{ name: string; result: PostToolUseHookResult }>;
  /**
   * Modified tool result (Round-2 verification item A9). When at
   * least one hook returned `modifiedResult`, this is the LAST
   * non-undefined value (chained overrides). When no hook modified
   * the result, this is `undefined` and the caller should use the
   * original tool output.
   */
  modifiedResult?: { content: string; isError?: boolean };
}

/**
 * The hook engine — registers, manages, and dispatches hooks.
 *
 * @module tools/hooks/engine
 */
export class HookEngine {
  private readonly hooks: Hook[] = [];
  private readonly log?: Logger;

  constructor(opts: HookEngineOptions = {}) {
    this.log = opts.logger;
  }

  /**
   * Register a hook.
   *
   * The previous implementation called `this.hooks.sort(...)` on
   * every `register()` call. For a static set of 6 builtin hooks
   * this is fine, but a plugin system registering dozens of hooks
   * at startup pays O(n² log n) total — every register triggers a
   * full sort. We now use a single insertion-sort step (binary
   * search + splice) which is O(n) per call instead of O(n log n).
   * For 100 hook registrations, this saves ~3× the sort cost.
   * @param hook
   */
  register(hook: Hook): void {
    // Insert at the right position to keep `this.hooks` sorted by
    // priority. Binary search for the insertion index, then splice.
    const priority = hook.priority ?? 100;
    let lo = 0;
    let hi = this.hooks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const midPriority = this.hooks[mid]!.priority ?? 100;
      if (midPriority < priority) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.hooks.splice(lo, 0, hook);
    this.log?.debug('Hook registered', {
      name: hook.name,
      event: hook.event,
      priority: hook.priority ?? 100,
    });
  }

  /**
   * Unregister a hook by name (only if disableable).
   * @param name
   */
  unregister(name: string): boolean {
    const idx = this.hooks.findIndex((h) => h.name === name);
    if (idx === -1) return false;
    const hook = this.hooks[idx]!;
    if (!hook.disableable) {
      this.log?.warn('Cannot unregister non-disableable hook', { name });
      return false;
    }
    this.hooks.splice(idx, 1);
    return true;
  }

  /**
   * List all registered hooks.
   */
  list(): Hook[] {
    return [...this.hooks];
  }

  /**
   * Get hooks for a specific event, sorted by priority.
   * @param event
   * @param toolName
   */
  getHooksForEvent(event: HookEvent, toolName?: string): Hook[] {
    return this.hooks
      .filter((h) => h.event === event)
      .filter((h) => !h.toolMatch || h.toolMatch.length === 0 || h.toolMatch.includes(toolName ?? ''))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Run all PreToolUse hooks for a tool call.
   *
   * Hooks fire in priority order. The first `deny` short-circuits.
   * If no hook denies but any hook asks, the result is `ask`.
   *
   * @param ctx - The hook context.
   * @returns The combined result.
   */
  async runPreToolUse(ctx: HookContext): Promise<PreToolUseResult> {
    const hooks = this.getHooksForEvent('PreToolUse', ctx.toolName);
    const hookResults: Array<{ name: string; result: PreToolUseHookResult }> = [];
    let finalDecision: 'allow' | 'deny' | 'ask' = 'allow';
    let reason: string | undefined;
    let modifiedInput: Record<string, unknown> | undefined;

    for (const hook of hooks) {
      try {
        const result = await (hook.handler as PreToolUseHandler)(ctx);
        hookResults.push({ name: hook.name, result });

        if (result.modifiedInput) {
          modifiedInput = result.modifiedInput;
          ctx.args = modifiedInput; // Pass modified input to next hook
        }

        if (result.decision === 'deny') {
          finalDecision = 'deny';
          reason = result.reason;
          break; // Short-circuit on deny
        }

        if (result.decision === 'ask') {
          finalDecision = 'ask';
          reason = result.reason;
        }
      } catch (err) {
        this.log?.error('PreToolUse hook crashed', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
        // A crashed hook is treated as deny (fail-safe)
        hookResults.push({
          name: hook.name,
          result: { decision: 'deny', reason: `Hook ${hook.name} crashed` },
        });
        finalDecision = 'deny';
        reason = `Hook ${hook.name} crashed`;
        break;
      }
    }

    return { decision: finalDecision, reason, modifiedInput, hookResults };
  }

  /**
   * Run all PostToolUse hooks for a tool call.
   *
   * All hooks fire (no short-circuit). Feedback is collected.
   *
   * @param ctx - The hook context (must include `result`).
   * @returns The combined result.
   */
  async runPostToolUse(ctx: HookContext): Promise<PostToolUseResult> {
    const hooks = this.getHooksForEvent('PostToolUse', ctx.toolName);
    const hookResults: Array<{ name: string; result: PostToolUseHookResult }> = [];
    const feedback: string[] = [];
    let reRun = false;
    // Round-2 verification item A9: track the latest non-undefined
    // `modifiedResult` so the caller can substitute the tool output.
    // We chain (last-wins) rather than merge because tool output is a
    // single string — merging would require a defined precedence that
    // callers can't reason about. Hooks that want to compose should
    // read the prior result from `ctx.result` and return their
    // composed version.
    let modifiedResult: { content: string; isError?: boolean } | undefined;

    for (const hook of hooks) {
      try {
        const result = await (hook.handler as PostToolUseHandler)(ctx);
        hookResults.push({ name: hook.name, result });

        if (result.feedback) {
          feedback.push(`[${hook.name}] ${result.feedback}`);
        }
        if (result.reRun) {
          reRun = true;
        }
        if (result.modifiedResult !== undefined) {
          modifiedResult = result.modifiedResult;
        }
      } catch (err) {
        this.log?.error('PostToolUse hook crashed', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
        // PostToolUse crashes are non-fatal — log and continue
      }
    }

    return { feedback, reRun, hookResults, modifiedResult };
  }

  /**
   * Run all UserPromptSubmit hooks.
   *
   * The first `false` short-circuits.
   *
   * @param prompt - The user's prompt.
   * @param ctx - Additional context.
   * @returns The combined result.
   */
  async runUserPromptSubmit(
    prompt: string,
    ctx: Omit<HookContext, 'args' | 'toolName'>,
  ): Promise<UserPromptSubmitHookResult & { hookResults: Array<{ name: string; result: UserPromptSubmitHookResult }> }> {
    const hooks = this.getHooksForEvent('UserPromptSubmit');
    const hookResults: Array<{ name: string; result: UserPromptSubmitHookResult }> = [];
    let allow = true;
    let modifiedPrompt = prompt;
    let reason: string | undefined;

    for (const hook of hooks) {
      try {
        const fullCtx: HookContext = {
          ...ctx,
          toolName: '__user_prompt__',
          args: {},
          prompt: modifiedPrompt,
        };
        const result = await (hook.handler as UserPromptSubmitHandler)(fullCtx);
        hookResults.push({ name: hook.name, result });

        if (!result.allow) {
          allow = false;
          reason = result.reason;
          break;
        }
        if (result.modifiedPrompt) {
          modifiedPrompt = result.modifiedPrompt;
        }
      } catch (err) {
        // Fail-SAFE: a crashed UserPromptSubmit hook blocks the
        // prompt. The previous implementation logged and CONTINUED
        // (fail-open), so a future UserPromptSubmit hook added for
        // prompt sanitization (e.g., blocking prompts containing
        // secrets) would be silently bypassed on a regex
        // catastrophic-backtracking crash. We now fail-closed:
        // treat a crashed safety hook as if it returned
        // `{ allow: false, reason: 'hook crashed' }` so the user
        // is told the prompt was blocked.
        this.log?.error('UserPromptSubmit hook crashed (fail-closed)', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
        allow = false;
        reason = `Hook "${hook.name}" crashed while inspecting the prompt — failing closed for safety. Error: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }

    return { allow, modifiedPrompt, reason, hookResults };
  }

  /**
   * Run all Stop hooks (for cleanup).
   * @param ctx
   */
  async runStop(ctx: Omit<HookContext, 'args' | 'toolName'>): Promise<void> {
    const hooks = this.getHooksForEvent('Stop');
    for (const hook of hooks) {
      try {
        await (hook.handler as StopHandler)({
          ...ctx,
          toolName: '__stop__',
          args: {},
        });
      } catch (err) {
        this.log?.error('Stop hook crashed', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Run SessionStart hooks.
   *
   * Fires when the agent loop starts a new session. Hooks can inject
   * additional context (e.g. loaded memory, project state).
   *
   * @param ctx
   * @returns Combined additional context from all hooks.
   */
  async runSessionStart(ctx: Omit<HookContext, 'args' | 'toolName'>): Promise<{ additionalContext: string }> {
    const hooks = this.getHooksForEvent('SessionStart');
    const contexts: string[] = [];
    for (const hook of hooks) {
      try {
        const result = await (hook.handler as SessionStartHandler)({
          ...ctx,
          toolName: '__session_start__',
          args: {},
        });
        if (result?.additionalContext) {
          contexts.push(result.additionalContext);
        }
      } catch (err) {
        this.log?.error('SessionStart hook crashed', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { additionalContext: contexts.join('\n\n') };
  }

  /**
   * Run PreCompact hooks.
   *
   * Fires before context compaction runs. Hooks can specify messages to
   * preserve (not summarize) and inject additional context into the summary.
   *
   * @param ctx
   * @returns Combined preservation directives from all hooks.
   */
  async runPreCompact(ctx: Omit<HookContext, 'args' | 'toolName'>): Promise<{
    preserveMessages: number[];
    additionalContext: string;
  }> {
    const hooks = this.getHooksForEvent('PreCompact');
    const allPreserve: number[] = [];
    const contexts: string[] = [];
    for (const hook of hooks) {
      try {
        const result = await (hook.handler as PreCompactHandler)({
          ...ctx,
          toolName: '__pre_compact__',
          args: {},
        });
        if (result?.preserveMessages) {
          allPreserve.push(...result.preserveMessages);
        }
        if (result?.additionalContext) {
          contexts.push(result.additionalContext);
        }
      } catch (err) {
        this.log?.error('PreCompact hook crashed', {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      preserveMessages: [...new Set(allPreserve)].sort((a, b) => a - b),
      additionalContext: contexts.join('\n\n'),
    };
  }
}
