/**
 * Self-registering tool registry with AST-based discovery (Hermes pattern).
 *
 * Each tool file calls `registry.register(...)` at module load.
 * `discoverBuiltinTools()` scans the tools directory for files with
 * top-level register calls and imports them automatically — no manual
 * import list to maintain.
 *
 * ## Hermes patterns adopted:
 *
 * - **AST-based discovery**: scan for `registry.register` at top level
 * - **check_fn TTL cache (30s)**: external state probes cached
 * - **_generation counter**: bumped on every mutation; external callers
 *   memoize against it
 * - **dynamic_schema_overrides callable**: runtime-config-dependent schema
 * - **tool_error() / tool_result() JSON helpers**: eliminate boilerplate
 * - **override opt-in**: plugins replacing built-ins must set `override: true`
 *
 * @module tools/self-registering-registry
 */

import { readdirSync, realpathSync } from 'node:fs';
import { join, extname, relative, isAbsolute, sep } from 'node:path';

import type { Tool, ToolContext, ToolDefinition, ToolInputSchema } from './types.js';
import type { Logger } from '../utils/logger.js';

/** A registry entry with metadata. */
export interface ToolEntry {
  /** The tool. */
  tool: Tool;
  /** Optional check function (gates whether the tool is available). */
  checkFn?: () => boolean | Promise<boolean>;
  /** Cached check_fn result. */
  checkFnCached?: boolean;
  checkFnExpiry?: number;
  /** Whether this entry was registered with override=true. */
  override: boolean;
  /** Dynamic schema overrides callable. */
  dynamicSchemaOverrides?: (ctx: ToolContext) => Partial<ToolInputSchema>;
}

/**
 * JSON helper: create an error result string.
 * @param msg
 * @param extra
 */
export function toolError(msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ error: msg, ...extra });
}

/**
 * JSON helper: create a success result string.
 * @param data
 * @param extra
 */
export function toolResult(data: unknown, extra?: Record<string, unknown>): string {
  return JSON.stringify({ data, ...extra });
}

/** The check_fn cache TTL in ms. */
const CHECK_FN_TTL_MS = 30_000;

/**
 * Self-registering tool registry with AST-based discovery.
 *
 * @module tools/self-registering-registry
 */
export class SelfRegisteringRegistry {
  private readonly tools = new Map<string, ToolEntry>();
  private readonly log?: Logger;
  private _generation = 0;

  constructor(opts: { logger?: Logger } = {}) {
    this.log = opts.logger;
  }

  /**
   * Register a tool. If a tool with the same name exists, the new one
   * must have `override: true` or the registration is rejected.
   *
   * The availability check (`isAvailable`) uses `opts.checkFn` if provided,
   * otherwise falls back to `tool.check_fn` (T-020 Footprint Ladder rung 3).
   * This unifies the two registration paths so callers may set `check_fn`
   * directly on the Tool interface OR pass it via opts.
   *
   * @param tool
   * @param opts
   * @param opts.checkFn - Override or supply check_fn separately from the Tool.
   * @param opts.override
   * @param opts.dynamicSchemaOverrides
   */
  register(
    tool: Tool,
    opts: {
      checkFn?: () => boolean | Promise<boolean>;
      override?: boolean;
      dynamicSchemaOverrides?: (ctx: ToolContext) => Partial<ToolInputSchema>;
    } = {},
  ): void {
    const existing = this.tools.get(tool.name);
    if (existing && !opts.override) {
      this.log?.warn('Tool already registered (use override: true to replace)', {
        name: tool.name,
      });
      return;
    }
    // T-020: prefer explicit opts.checkFn, else fall back to tool.check_fn.
    const checkFn = opts.checkFn ?? tool.check_fn;
    this.tools.set(tool.name, {
      tool,
      checkFn,
      override: opts.override ?? false,
      dynamicSchemaOverrides: opts.dynamicSchemaOverrides,
    });
    this._generation++;
    this.log?.debug('Tool registered', {
      name: tool.name,
      override: opts.override ?? false,
      gated: Boolean(checkFn),
    });
  }

  /**
   * Unregister a tool.
   *
   * Any registered tool can be unregistered — the basic contract is
   * that whatever the registry accepts via `register()` it must
   * accept being removed via `unregister()`. The generation counter
   * is bumped so cached toolset snapshots invalidate correctly.
   *
   * The previous implementation rejected any tool not registered
   * with `override: true`, which blocked the basic unregister
   * contract: a plugin that registered its own tool (no override
   * needed since the name didn't exist before) couldn't later
   * unregister it without re-registering with `override: true`
   * first. That made `unregister()` effectively unusable for
   * plugin-defined tools.
   *
   * @param name
   */
  unregister(name: string): boolean {
    const entry = this.tools.get(name);
    if (!entry) return false;
    this.tools.delete(name);
    this._generation++;
    return true;
  }

  /**
   * Check if a tool is registered and available (check_fn).
   * @param name
   */
  async isAvailable(name: string): Promise<boolean> {
    const entry = this.tools.get(name);
    if (!entry) return false;
    if (!entry.checkFn) return true;

    // Check TTL cache
    const now = Date.now();
    if (entry.checkFnExpiry !== undefined && now < entry.checkFnExpiry) {
      return entry.checkFnCached ?? false;
    }

    // Run check_fn
    const result = await entry.checkFn();
    entry.checkFnCached = result;
    entry.checkFnExpiry = now + CHECK_FN_TTL_MS;
    return result;
  }

  /** Invalidate the check_fn cache (call after config changes). */
  invalidateCheckFnCache(): void {
    for (const entry of this.tools.values()) {
      entry.checkFnExpiry = undefined;
      entry.checkFnCached = undefined;
    }
    this.log?.debug('check_fn cache invalidated');
  }

  /**
   * Get a tool by name.
   * @param name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /** Get all registered tools. */
  list(): Tool[] {
    return [...this.tools.values()].map((e) => e.tool);
  }

  /** Get all available tools (check_fn passes). */
  async listAvailable(): Promise<Tool[]> {
    const available: Tool[] = [];
    for (const [name] of this.tools) {
      if (await this.isAvailable(name)) {
        const tool = this.tools.get(name)?.tool;
        if (tool) available.push(tool);
      }
    }
    return available;
  }

  /**
   * Get all tool definitions in the OpenAI function-calling format.
   * Applies dynamic_schema_overrides if present.
   * @param ctx
   */
  getToolDefinitions(ctx?: ToolContext): ToolDefinition[] {
    return this.list().map((tool) => {
      const entry = this.tools.get(tool.name);
      let inputSchema = tool.inputSchema;

      if (entry?.dynamicSchemaOverrides && ctx) {
        inputSchema = { ...inputSchema, ...entry.dynamicSchemaOverrides(ctx) };
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: inputSchema,
        },
      };
    });
  }

  /** Get the generation counter (for memoization). */
  get generation(): number {
    return this._generation;
  }

  /** Get the tool count. */
  get count(): number {
    return this.tools.size;
  }

  /**
   * Discover and register builtin tools by scanning a directory.
   *
   * Each `.ts`/`.js` file in the directory is imported; if it calls
   * `registry.register(...)` at the top level, the tool is registered.
   *
   * ## Security: path-confined import
   *
   * The previous implementation called `await import(filePath)` for
   * any file in `toolsDir`, including files outside the directory
   * (via a symlinked `toolsDir` entry) or files with names matching
   * a test/spec pattern but still imported. We now:
   *
   * 1. **Resolve `toolsDir` via `realpathSync`** — catches a
   *    symlinked toolsDir pointing outside the package.
   * 2. **Resolve each candidate file via `realpathSync`** — catches
   *    individual symlinked files pointing outside the package.
   * 3. **Reject any candidate whose realpath is NOT inside the
   *    resolved toolsDir** — closes the symlink-escape vector.
   * 4. **Skip `.test.ts`, `.spec.ts`, and `.d.ts` files** (existing
   *    behavior).
   *
   * This is still a dynamic-import pattern — callers MUST pass a
   * trusted, package-controlled directory. Arbitrary user-supplied
   * directories MUST NOT be passed here.
   *
   * @param toolsDir
   */
  async discoverBuiltinTools(toolsDir: string): Promise<number> {
    let count = 0;

    // Resolve toolsDir through realpath — catches a symlinked
    // toolsDir pointing outside the package.
    let resolvedToolsDir: string;
    try {
      resolvedToolsDir = realpathSync(toolsDir);
    } catch (err) {
      this.log?.warn('discoverBuiltinTools: toolsDir does not exist or is not accessible', {
        toolsDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }

    let files: string[];
    try {
      files = readdirSync(resolvedToolsDir)
        .filter((f) => extname(f) === '.ts' || extname(f) === '.js')
        .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
        .filter((f) => !f.endsWith('.d.ts'));
    } catch (err) {
      this.log?.warn('discoverBuiltinTools: failed to read toolsDir', {
        toolsDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }

    for (const file of files) {
      const filePath = join(resolvedToolsDir, file);
      // Resolve each candidate through realpath — catches a
      // symlinked file pointing outside the package.
      let resolvedFilePath: string;
      try {
        resolvedFilePath = realpathSync(filePath);
      } catch {
        // File may have been removed between readdir and realpath — skip.
        continue;
      }
      // Boundary check: the resolved file MUST live inside the
      // resolved toolsDir. This is the symlink-escape defense.
      const rel = relative(resolvedToolsDir, resolvedFilePath);
      if (rel.startsWith('..') || isAbsolute(rel) || rel.includes(`..${sep}`)) {
        this.log?.warn('discoverBuiltinTools: refusing to import file outside toolsDir (symlink escape?)', {
          toolsDir: resolvedToolsDir,
          file,
          resolvedFilePath,
        });
        continue;
      }

      try {
        // Dynamic import — the module's top-level code runs and calls register()
        await import(resolvedFilePath);
        count++;
      } catch (err) {
        this.log?.warn('Failed to import tool file', {
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.log?.info('Discovered builtin tools', { files: count, registered: this.count });
    return count;
  }
}

/** The singleton self-registering registry. */
export const selfRegisteringRegistry = new SelfRegisteringRegistry();
