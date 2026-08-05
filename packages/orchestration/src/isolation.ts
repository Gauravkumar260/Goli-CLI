/**
 * Subagent context isolation (Module 2).
 *
 * Spawns subagents with fresh context, curated tools, and an enforced
 * return budget (default: 1000 tokens). The subagent runs the agent
 * loop in isolation and returns a distilled summary — not the full
 * conversation — to the parent.
 *
 * ## Why isolation?
 *
 * Without isolation, a subagent dumps 8K+ tokens of output into the
 * parent's context, defeating the purpose of spawning a subagent. The
 * return budget forces the subagent to distill its findings.
 *
 * ## Subagent types
 *
 * - **research**: read-only exploration. Tools: read_file, list_directory,
 *   grep, symbol_lookup. Returns a 1000-token summary.
 * - **implementation**: hands-on coding. Tools: read_file, write_file,
 *   edit_file, bash (sandboxed). Returns a 2000-token summary.
 * - **review**: read-only audit. Tools: read_file, grep, bash (read-only).
 *   Returns a 1000-token summary.
 *
 * @module context/subagent/isolation
 */

import type { SubagentType, SubagentSpawnRequest, SubagentResult } from '@goli-cli/context-engine';
import type { AgentRole } from '@goli-cli/shared';
import type { Logger } from '@goli-cli/shared/utils/logger.js';


/** Configuration for each subagent type. */
export interface SubagentConfig {
  /** The system prompt for this subagent type. */
  systemPrompt: string;
  /** Allowed tool names. */
  allowedTools: string[];
  /** The agent role. */
  role: AgentRole;
  /** Default return budget (tokens). */
  defaultReturnTokens: number;
}

/** The configs for each subagent type. */
export const SUBAGENT_CONFIGS: Record<SubagentType, SubagentConfig> = {
  research: {
    systemPrompt:
      'You are a Research subagent. Your job is to explore the codebase and answer questions. ' +
      'You have read-only access. Return a concise summary of your findings (max 1000 tokens). ' +
      'Focus on: file paths, function names, call relationships, and key findings. ' +
      'Do NOT include full file contents in your summary — just the relevant snippets.',
    allowedTools: ['read_file', 'list_directory', 'grep', 'plan_task'],
    role: 'scout',
    defaultReturnTokens: 1000,
  },
  implementation: {
    systemPrompt:
      'You are an Implementation subagent. Your job is to make code changes. ' +
      'You have write access to the workspace. Return a concise summary of what you changed ' +
      '(max 2000 tokens). Include: files modified, functions changed, tests run, and any issues.',
    allowedTools: ['read_file', 'write_file', 'edit_file', 'bash', 'list_directory', 'grep', 'plan_task'],
    role: 'implementer',
    defaultReturnTokens: 2000,
  },
  review: {
    systemPrompt:
      'You are a Review subagent. Your job is to review code changes for correctness, ' +
      'security, and style. You have read-only access. Return a concise review summary ' +
      '(max 1000 tokens). Include: issues found, severity, and suggested fixes.',
    allowedTools: ['read_file', 'grep', 'list_directory', 'plan_task'],
    role: 'reviewer',
    defaultReturnTokens: 1000,
  },
};

/** Options for the SubagentIsolator. */
export interface SubagentIsolatorOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The agent loop runner (called to run the subagent). */
  runAgentLoop: (params: {
    prompt: string;
    role: AgentRole;
    systemPrompt: string;
    allowedTools: string[];
    returnTokenBudget: number;
  }) => Promise<{ content: string; ok: boolean; tokensUsed: number; error?: string }>;
}

/**
 * Subagent isolator — spawns subagents with isolated context.
 *
 * @module context/subagent/isolation
 */
export class SubagentIsolator {
  private readonly log?: Logger;
  private readonly runAgentLoop: SubagentIsolatorOptions['runAgentLoop'];

  constructor(opts: SubagentIsolatorOptions) {
    this.log = opts.logger;
    this.runAgentLoop = opts.runAgentLoop;
  }

  /**
   * Spawn a subagent with isolated context.
   *
   * @param request - The spawn request.
   * @returns The subagent result (with distilled summary).
   */
  async spawn(request: SubagentSpawnRequest): Promise<SubagentResult> {
    const config = SUBAGENT_CONFIGS[request.type];
    if (!config) {
      return {
        summary: '',
        ok: false,
        error: `Unknown subagent type: ${request.type}`,
        tokensUsed: 0,
        durationMs: 0,
      };
    }

    const returnBudget = request.maxReturnTokens ?? config.defaultReturnTokens;
    const startTime = Date.now();

    this.log?.info('Spawning subagent', {
      type: request.type,
      role: config.role,
      returnBudget,
      prompt: request.prompt.slice(0, 100),
    });

    try {
      const result = await this.runAgentLoop({
        prompt: request.prompt,
        role: config.role,
        systemPrompt: config.systemPrompt,
        allowedTools: config.allowedTools,
        returnTokenBudget: returnBudget,
      });

      // Enforce the return budget — truncate if necessary
      const summary = this.enforceBudget(result.content, returnBudget);

      this.log?.info('Subagent completed', {
        type: request.type,
        ok: result.ok,
        tokensUsed: result.tokensUsed,
        durationMs: Date.now() - startTime,
        truncated: summary !== result.content,
      });

      return {
        summary,
        ok: result.ok,
        error: result.error,
        tokensUsed: result.tokensUsed,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.error('Subagent failed', { type: request.type, error: message });
      return {
        summary: '',
        ok: false,
        error: message,
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Enforce the return budget by truncating the summary.
   *
   * Uses `Array.from(content).slice(0, maxChars)` instead of
   * `content.slice(0, maxChars)` so the slice is on Unicode code
   * points (not UTF-16 code units). The previous implementation
   * could split surrogate pairs (emoji, astral-plane CJK), producing
   * invalid UTF-8 / U+FFFD replacement chars that downstream parsers
   * reject. Chars-per-token estimate is 4 (the documented contract
   * callers rely on for budget math).
   * @param content
   * @param budgetTokens
   */
  private enforceBudget(content: string, budgetTokens: number): string {
    // 4 chars per token — the documented contract callers rely on
    // for budget math (a 2000-token budget yields ≤ 8000 chars of
    // summary). The previous implementation used 5 chars/token which
    // over-allocated and broke budget-bound callers expecting ≤ 4×.
    const maxChars = budgetTokens * 4;
    if (content.length <= maxChars) return content;

    // Code-point-safe slice (Array.from splits on code points).
    const codePoints = Array.from(content);
    if (codePoints.length <= maxChars) return content;
    const truncated = codePoints.slice(0, maxChars).join('');
    // Try to cut at a sentence boundary
    const lastPeriod = truncated.lastIndexOf('. ');
    if (lastPeriod > maxChars * 0.8) {
      return truncated.slice(0, lastPeriod + 1) + '\n\n[... truncated to fit return budget ...]';
    }
    return truncated + '\n\n[... truncated to fit return budget ...]';
  }

  /**
   * Get the config for a subagent type.
   * @param type
   */
  getConfig(type: SubagentType): SubagentConfig {
    return SUBAGENT_CONFIGS[type];
  }
}
