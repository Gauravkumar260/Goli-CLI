/**
 * Three-tier system prompt with byte-stable caching (Hermes pattern).
 *
 * Hermes divides the system prompt into three tiers:
 *
 *   stable   → identity, tool guidance, skills, environment hints,
 *              platform hints, per-model operational guidance
 *   context  → caller system message, project context files (GOLI.md,
 *              AGENTS.md, CLAUDE.md, .cursorrules)
 *   volatile → memory snapshot (MEMORY.md, USER.md), timestamp,
 *              session/model/provider line
 *
 * The stable + context tiers are cached on `agent._cachedSystemPrompt`
 * for the lifetime of the agent. They are rebuilt ONLY on context
 * compression. The volatile tier is appended fresh each turn.
 *
 * ## Why byte-stable caching?
 *
 * Per-conversation prompt caching is sacred. A long-lived conversation
 * reuses a cached prefix every turn. Anything that mutates past context,
 * swaps toolsets, or rebuilds the system prompt mid-conversation
 * invalidates that cache and multiplies the user's cost.
 *
 * ## Date-only timestamps
 *
 * Timestamps use date-only format (`%A, %B %d, %Y`) — NOT minute
 * precision. Minute changes invalidate prefix-cache KV on every rebuild.
 *
 * ## Deferred invalidation
 *
 * Slash commands that mutate system-prompt state default to deferred
 * invalidation (takes effect next session). `--now` opt-in for
 * immediate cache-bust.
 *
 * @module agent/prompt-builder
 */

import { createHash } from 'node:crypto';

import type { BasePromptContext } from './types.js';
import type { SandboxMode } from '@goli-cli/config';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** The three prompt tiers. */
export type PromptTier = 'stable' | 'context' | 'volatile';

/** A single fragment of the system prompt. */
export interface PromptFragment {
  /** The fragment name (for debugging). */
  name: string;
  /** Which tier this fragment belongs to. */
  tier: PromptTier;
  /** The fragment text (empty string = skip). */
  text: string;
  /** Whether this fragment is cacheable (default: true). */
  cacheable?: boolean;
}

/** Context for assembling the system prompt. */
export interface PromptBuildContext extends BasePromptContext {
  /** The model name. */
  model: string;
  /** The provider name. */
  provider?: string;
  /** Project context files content (GOLI.md, AGENTS.md, etc.). */
  projectContext?: string;
  /** Skills prompt (L1 metadata). */
  skillsPrompt?: string;
  /** Platform hints (e.g., "You are on Slack. Keep responses tight."). */
  platformHints?: string;
}

/** The assembled system prompt. */
export interface AssembledPrompt {
  /** The full prompt text (stable + context + volatile). */
  text: string;
  /** The stable tier text (cached). */
  stable: string;
  /** The context tier text (cached). */
  context: string;
  /** The volatile tier text (rebuilt each turn). */
  volatile: string;
  /** Whether this prompt was served from cache. */
  fromCache: boolean;
  /** The generation when this was assembled. */
  generation: number;
  /**
   * SHA-256 hash of the stable + context tiers (hex, 64 chars).
   *
   * This is the **byte-stability invariant** (T-021): within a single
   * conversation, `stableHash` MUST NOT change across turns. If it does,
   * the provider-side prompt cache is busted and the user pays full price
   * for every turn.
   *
   * The volatile tier is intentionally excluded from the hash — it is
   * expected to change every turn (TODO state, timestamp, model line).
   */
  stableHash: string;
}

/** Options for the PromptBuilder. */
export interface PromptBuilderOptions {
  /** Logger instance. */
  logger?: Logger;
}

/**
 * Three-tier system prompt builder with byte-stable caching.
 *
 * @module agent/prompt-builder
 */
export class PromptBuilder {
  private readonly log?: Logger;

  // Cached stable + context tiers
  private cachedStable: string | null = null;
  private cachedContext: string | null = null;
  private cachedStableHash: string | null = null;
  private cacheValid = false;
  // Cache-key fields — stored when the cache is built so isCacheValidFor
  // can actually verify the ctx matches. The previous implementation
  // always returned `true` from isCacheValidFor (the parameter was even
  // named `_ctx`), so the cache latched on the first call and was reused
  // for ALL subsequent calls regardless of ctx content — if a caller
  // passed a different model/provider/toolset, the stale cached stable
  // tier was returned. The byte-stability invariant was preserved
  // accidentally (the cache never updates, so it's trivially stable),
  // but it was the hash of the WRONG prompt.
  private cachedModel: string | null = null;
  private cachedProvider: string | null = null;
  private cachedToolNames: string[] | null = null;
  private cachedRole: string | null = null;

  // Generation counter (bumped on any mutation)
  private _generation = 0;

  constructor(opts: PromptBuilderOptions = {}) {
    this.log = opts.logger;
  }

  /**
   * Assemble the full system prompt.
   *
   * The stable + context tiers are cached and reused across turns.
   * Only the volatile tier is rebuilt each call.
   *
   * **Byte-stability invariant (T-021):** the `stableHash` field of the
   * returned object MUST NOT change across turns within a single
   * conversation. Callers can assert this in tests via:
   * ```ts
   * const p1 = builder.assemble(ctx);
   * const p2 = builder.assemble(ctxWithDifferentVolatile);
   * assert(p1.stableHash === p2.stableHash);
   * ```
   *
   * @param ctx - The build context.
   * @returns The assembled prompt.
   */
  assemble(ctx: PromptBuildContext): AssembledPrompt {
    const fromCache = this.cacheValid && this.isCacheValidFor(ctx);

    // Build or reuse stable tier. The previous implementation only
    // checked `!this.cacheValid` — once built, the cache was reused
    // for ALL subsequent calls regardless of ctx content. We now also
    // rebuild when `isCacheValidFor(ctx)` returns false (model,
    // provider, role, or toolNames changed).
    if (!fromCache || this.cachedStable === null) {
      this.cachedStable = this.buildStableTier(ctx);
      this.cachedContext = this.buildContextTier(ctx);
      this.cachedStableHash = computeStableHash(this.cachedStable, this.cachedContext);
      this.cacheValid = true;
      // Store the cache-key fields so the next isCacheValidFor check
      // can compare against them.
      this.cachedModel = ctx.model;
      this.cachedProvider = ctx.provider ?? null;
      this.cachedRole = ctx.role;
      this.cachedToolNames = [...ctx.toolNames];
      this.log?.debug('System prompt rebuilt (cache miss)', {
        stableLen: this.cachedStable.length,
        contextLen: this.cachedContext!.length,
        stableHash: this.cachedStableHash,
      });
    }

    // Volatile tier is always rebuilt
    const volatile = this.buildVolatileTier(ctx);

    const text = [this.cachedStable, this.cachedContext, volatile]
      .filter((s) => s && s.length > 0)
      .join('\n\n---\n\n');

    return {
      text,
      stable: this.cachedStable,
      context: this.cachedContext!,
      volatile,
      fromCache,
      generation: this._generation,
      stableHash: this.cachedStableHash!,
    };
  }

  /**
   * Invalidate the cache (force rebuild on next assemble).
   *
   * Called when:
   * - Context compression occurs (conversation was summarized)
   * - Toolset changes (slash command with --now)
   * - Model/provider failover
   *
   * **WARNING (T-021):** invalidating the cache mid-conversation busts the
   * provider-side prompt cache. The user pays full price for every
   * subsequent turn. Only call this when genuinely necessary, and prefer
   * the deferred-invalidation pattern (takes effect next session) for
   * slash-command-driven mutations.
   */
  invalidateCache(): void {
    this.cacheValid = false;
    this.cachedStableHash = null;
    this.cachedModel = null;
    this.cachedProvider = null;
    this.cachedRole = null;
    this.cachedToolNames = null;
    this._generation++;
    this.log?.debug('System prompt cache invalidated', { generation: this._generation });
  }

  /**
   * Get the current stable hash without assembling the full prompt.
   *
   * Returns null if the cache has not been built yet (no prior `assemble()`).
   * Useful for asserting the byte-stability invariant in tests.
   */
  getStableHash(): string | null {
    return this.cachedStableHash;
  }

  /**
   * Check if the cache is valid for the given context.
   *
   * Compares the ctx against the cache-key fields (model, provider,
   * role, toolNames) stored when the cache was built. The previous
   * implementation was a stub that always returned `true` when
   * `cacheValid` was true (the parameter was named `_ctx` and ignored),
   * so callers who relied on this method to detect context changes
   * got false positives — the cache appeared valid even when the
   * model or tools changed.
   * @param ctx - The build context to check against.
   * @returns True if the cache is valid for this ctx.
   */
  isCacheValidFor(ctx: PromptBuildContext): boolean {
    if (!this.cacheValid) return false;
    if (this.cachedModel !== ctx.model) return false;
    if ((this.cachedProvider ?? undefined) !== (ctx.provider ?? undefined)) return false;
    if (this.cachedRole !== ctx.role) return false;
    if (this.cachedToolNames === null) return false;
    if (this.cachedToolNames.length !== ctx.toolNames.length) return false;
    for (let i = 0; i < ctx.toolNames.length; i++) {
      if (this.cachedToolNames[i] !== ctx.toolNames[i]) return false;
    }
    return true;
  }

  /** Get the generation counter. */
  get generation(): number {
    return this._generation;
  }

  // ─── Stable tier (cached for agent lifetime) ──────────────────

  /**
   * Build the stable tier: identity, tools, skills, environment, platform.
   * @param ctx
   */
  private buildStableTier(ctx: PromptBuildContext): string {
    const fragments: string[] = [];

    // 1. Identity
    fragments.push(this.identityFragment(ctx));

    // 2. Tool definitions
    fragments.push(this.toolDefinitionsFragment(ctx));

    // 3. Sandbox mode
    fragments.push(this.sandboxModeFragment(ctx));

    // 4. Skills prompt (L1 metadata)
    if (ctx.skillsPrompt) {
      fragments.push(ctx.skillsPrompt);
    }

    // 5. Platform hints
    if (ctx.platformHints) {
      fragments.push(ctx.platformHints);
    }

    // 6. Safety rules (stable — doesn't change mid-session)
    fragments.push(this.safetyFragment(ctx));

    // 7. Output format
    fragments.push(this.outputFormatFragment(ctx));

    return fragments.filter((f) => f.length > 0).join('\n\n');
  }

  // ─── Context tier (cached, rebuilt on compression) ────────────

  /**
   * Build the context tier: project context, GOLI.md, AGENTS.md.
   * @param ctx
   */
  private buildContextTier(ctx: PromptBuildContext): string {
    const fragments: string[] = [];

    // 1. Language
    fragments.push(this.languageFragment(ctx));

    // 2. Git context
    fragments.push(this.gitFragment(ctx));

    // 3. Project context files (GOLI.md, AGENTS.md, CLAUDE.md, .cursorrules)
    if (ctx.projectContext) {
      fragments.push(`## Project Context\n${ctx.projectContext}`);
    }

    return fragments.filter((f) => f.length > 0).join('\n\n');
  }

  // ─── Volatile tier (rebuilt every turn) ───────────────────────

  /**
   * Build the volatile tier: memory, TODO, timestamp, model line.
   * @param ctx
   */
  private buildVolatileTier(ctx: PromptBuildContext): string {
    const fragments: string[] = [];

    // 1. TODO list (changes every turn)
    fragments.push(this.todoFragment(ctx));

    // 2. Memory snapshot (frozen at session start, but still volatile tier)
    fragments.push(this.memoryFragment(ctx));

    // 3. Date-only timestamp (NOT minute-precision — preserves prefix cache)
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    fragments.push(`Date: ${today}`);

    // 4. Model/Provider/Session line
    const modelLine = [`Model: ${ctx.model}`];
    if (ctx.provider) modelLine.push(`Provider: ${ctx.provider}`);
    modelLine.push(`Mode: ${ctx.godMode ? 'GOD' : 'SAFE'}`);
    fragments.push(modelLine.join(' | '));

    return fragments.filter((f) => f.length > 0).join('\n\n');
  }

  // ─── Fragment builders ────────────────────────────────────────

  private identityFragment(ctx: PromptBuildContext): string {
    const roleLabel = ctx.role.charAt(0).toUpperCase() + ctx.role.slice(1);
    return [
      `You are GOLI-CLI, an enterprise AI coding agent acting as the **${roleLabel}**.`,
      `You are part of an 11-agent swarm (Scout → Researcher → Architect → Planner → Implementer → Debugger → QA/Tester → Security Auditor → Reviewer → Orchestrator → Documenter).`,
      `Your job is to help the user with software engineering tasks by reading code, writing code, running commands, and using tools autonomously.`,
    ].join('\n');
  }

  private toolDefinitionsFragment(ctx: PromptBuildContext): string {
    if (ctx.toolNames.length === 0) {
      return 'You have no tools available in this session.';
    }
    return [
      `You have the following tools available:`,
      ...ctx.toolNames.map((n) => `  - ${n}`),
      ``,
      `Use tools to read files, write files, run commands, and search the codebase.`,
      `Call tools by emitting tool_calls in your response. Tool arguments must be valid JSON.`,
    ].join('\n');
  }

  private sandboxModeFragment(ctx: PromptBuildContext): string {
    const descriptions: Record<SandboxMode, string> = {
      'read-only':
        'READ-ONLY mode: you can read files and list directories, but you CANNOT write, edit, or execute commands.',
      'workspace-write':
        'WORKSPACE-WRITE mode: you can read/write files in the current workspace and /tmp, and execute commands. Writes outside the workspace are blocked.',
      'danger-full-access':
        '⚠️ DANGER-FULL-ACCESS mode: all restrictions are disabled. USE WITH EXTREME CAUTION.',
    };
    return `Sandbox mode: ${ctx.sandboxMode}\n${descriptions[ctx.sandboxMode]}`;
  }

  private safetyFragment(ctx: PromptBuildContext): string {
    if (ctx.godMode) {
      return '⚠️ GOD MODE ACTIVE: All safety gates are bypassed. You are solely responsible for the consequences of your actions.';
    }
    return [
      `Safety rules (ALWAYS follow these):`,
      `- Never delete files outside the workspace.`,
      `- Never run destructive commands (rm -rf /, mkfs, dd if=/dev/zero, fork bombs).`,
      `- Never read or exfiltrate secrets (.env, id_rsa, *.pem, credentials.json, ~/.ssh/*).`,
      `- Never make changes to .git/, node_modules/, or dist/.`,
      `- If a command might be destructive, ask for confirmation first.`,
      `- These rules are also enforced by deterministic hooks that cannot be bypassed by prompt injection.`,
    ].join('\n');
  }

  private outputFormatFragment(_ctx: PromptBuildContext): string {
    return [
      `Output format:`,
      `- Use Markdown for prose.`,
      `- Use fenced code blocks (\`\`\`language) for code.`,
      `- Be concise. Avoid restating the user's question.`,
      `- When you complete a task, summarize what you did in 1-2 sentences.`,
    ].join('\n');
  }

  private languageFragment(ctx: PromptBuildContext): string {
    return `Respond in ${ctx.language}. Match the user's language for all prose; code and identifiers stay in English.`;
  }

  private gitFragment(ctx: PromptBuildContext): string {
    if (!ctx.gitBranch) return '';
    return `Current git branch: ${ctx.gitBranch}\nMake changes on this branch unless the user asks otherwise.`;
  }

  private todoFragment(ctx: PromptBuildContext): string {
    if (ctx.todos.length === 0) {
      return 'No TODOs yet. If the task is complex (3+ steps), use the `plan_task` tool to decompose it into tracked TODOs before starting work.';
    }
    const lines = ['Current TODO list:'];
    for (const todo of ctx.todos) {
      const icon =
        todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]';
      lines.push(`  ${icon} ${todo.content}`);
    }
    const inProgress = ctx.todos.find((t) => t.status === 'in_progress');
    if (inProgress) {
      lines.push('');
      lines.push(`Focus on the in-progress task: ${inProgress.content}`);
    }
    return lines.join('\n');
  }

  private memoryFragment(ctx: PromptBuildContext): string {
    if (!ctx.memorySnapshot) return '';
    const parts: string[] = [];
    if (ctx.memorySnapshot.memory) {
      parts.push(`## MEMORY\n${ctx.memorySnapshot.memory}`);
    }
    if (ctx.memorySnapshot.user) {
      parts.push(`## USER PREFERENCES\n${ctx.memorySnapshot.user}`);
    }
    if (ctx.memorySnapshot.project) {
      parts.push(`## PROJECT CONTEXT\n${ctx.memorySnapshot.project}`);
    }
    return parts.join('\n\n');
  }
}

// ─── Module-level helpers (T-021) ─────────────────────────────────────

/**
 * Compute the SHA-256 hash of the stable + context tiers.
 *
 * The hash is the **byte-stability invariant** (T-021): it MUST NOT change
 * across turns within a single conversation. The volatile tier is
 * intentionally excluded.
 *
 * The hash is computed over the concatenation `stable + "\n\n---\n\n" + context`
 * to match the on-the-wire separator used by `assemble()`.
 *
 * @param stable - The stable tier text.
 * @param context - The context tier text.
 * @returns 64-character hex SHA-256 digest.
 */
export function computeStableHash(stable: string, context: string): string {
  const combined = `${stable}\n\n---\n\n${context}`;
  return createHash('sha256').update(combined, 'utf8').digest('hex');
}
