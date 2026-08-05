/**
 * ToolsetSnapshot — freezes the available tool list at conversation start
 * (T-021: per-conversation prompt caching invariant).
 *
 * ## Why this exists
 *
 * The agent loop calls `ToolRegistry.getAvailableToolDefinitions()` to
 * build the `tools` array sent to the LLM. With T-020's `check_fn`, the
 * available set can change between turns (e.g. an LSP server starts, an
 * env var is set). If the tool list changes mid-conversation:
 *
 *   1. The system prompt's `toolDefinitionsFragment` changes (it lists
 *      tool names).
 *   2. The `stableHash` changes (it covers the stable tier).
 *   3. The provider-side prompt cache is busted.
 *   4. The user pays full price for every subsequent turn.
 *
 * To preserve byte-stability, the tool list is snapshotted ONCE at the
 * start of the conversation and reused for every subsequent turn. A
 * slash command that wants to swap toolsets mid-conversation must
 * explicitly opt in via `--now` (which calls `invalidate()`).
 *
 * ## Deferred invalidation (default)
 *
 * When a tool's `check_fn` flips (env var set, LSP server starts), the
 * snapshot does NOT immediately pick up the new tool. Instead, the
 * change takes effect on the NEXT conversation (next `goli` invocation).
 * This is the Hermes pattern: prompt caching is sacred.
 *
 * ## Opt-in immediate invalidation (`--now`)
 *
 * A slash command like `/tools refresh --now` calls `snapshot.invalidate()`
 * to force a re-snapshot. This busts the cache but is the user's explicit
 * choice. The agent loop logs a warning so the cost is visible.
 *
 * @module agent/toolset-snapshot
 */

import { createRequire } from 'node:module';

import type { ToolDefinition } from '../tools/types.js';

/**
 * A frozen snapshot of the tool definitions available at conversation start.
 *
 * The snapshot is immutable once created. To pick up new tools (e.g. an LSP
 * server that started mid-conversation), call `invalidate()` and a new
 * snapshot will be created on the next `getTools()` call.
 */
export class ToolsetSnapshot {
  private tools: readonly ToolDefinition[];
  private readonly toolNamesHash: string;
  private snapshotGeneration = 0;

  constructor(tools: ToolDefinition[]) {
    // Freeze the array and each tool definition to prevent accidental mutation.
    this.tools = Object.freeze(
      tools.map((t) => Object.freeze({ ...t })),
    ) as readonly ToolDefinition[];
    this.toolNamesHash = computeToolNamesHash(this.tools);
  }

  /**
   * Get the frozen tool definitions.
   *
   * Returns the SAME array reference every call — callers can rely on
   * identity equality to detect changes.
   */
  getTools(): readonly ToolDefinition[] {
    return this.tools;
  }

  /**
   * Get a stable hash of the tool NAMES (not full definitions — schemas
   * are not part of the system prompt's tool fragment, only names are).
   *
   * This hash is included in the system prompt's stable tier hash, so
   * any change in the tool list would bust the cache.
   */
  getToolNamesHash(): string {
    return this.toolNamesHash;
  }

  /** Get the snapshot generation (bumped on each `invalidate()`). */
  get generation(): number {
    return this.snapshotGeneration;
  }

  /**
   * Check whether the snapshot is stale vs the given tool list.
   *
   * Returns true if the tool NAMES differ (order-sensitive). This is
   * used by the agent loop to decide whether to log a "deferred
   * invalidation" warning (the snapshot is NOT automatically refreshed).
   *
   * @param currentTools - The current tool list from the registry.
   * @returns True if the snapshot is stale (tool names differ).
   */
  isStaleVs(currentTools: readonly ToolDefinition[]): boolean {
    const currentHash = computeToolNamesHash(currentTools);
    return currentHash !== this.toolNamesHash;
  }

  /**
   * Invalidate the snapshot.
   *
   * This does NOT immediately re-snapshot — it just marks the snapshot
   * as invalid so the agent loop knows to create a new one on the next
   * turn. The new snapshot will pick up any tools whose `check_fn` now
   * passes.
   *
   * **WARNING (T-021):** invalidating the snapshot mid-conversation
   * busts the provider-side prompt cache. Only do this when the user
   * explicitly opts in via `--now`.
   */
  invalidate(): void {
    this.snapshotGeneration++;
  }
}

/**
 * Compute a stable hash of tool names (order-sensitive).
 *
 * Used to detect whether the tool list has changed between snapshot
 * creation and a later probe. The hash covers only names — full schemas
 * are not part of the system prompt's tool fragment.
 *
 * @param tools - The tool definitions.
 * @returns 64-character hex SHA-256 digest of the tool names.
 */
export function computeToolNamesHash(tools: readonly ToolDefinition[]): string {
   
  const { createHash } = createRequire(import.meta.url)('node:crypto');
  const names = tools.map((t) => t.function.name).join('\n');
  return createHash('sha256').update(names, 'utf8').digest('hex');
}
