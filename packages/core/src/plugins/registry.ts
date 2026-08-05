/**
 * Plugin system (Hermes pattern).
 *
 * 4 discovery sources (later overrides earlier on name collision):
 * 1. Bundled plugins (packages/core/src/plugins/builtin/)
 * 2. User plugins (~/.goli-cli/plugins/<name>/)
 * 3. Project plugins (./.goli/plugins/<name>/) — opt-in via GOLI_ENABLE_PROJECT_PLUGINS
 * 4. npm entry points (goli-cli-plugins)
 *
 * PluginContext.register_*: register_tool, register_cli_command,
 * register_hook, register_middleware.
 *
 * 22 VALID_HOOKS: pre_tool_call, post_tool_call, transform_terminal_output,
 * transform_tool_result, transform_llm_output, pre_llm_call, post_llm_call,
 * pre_api_request, post_api_request, api_request_error, on_session_start,
 * on_session_end, on_session_finalize, on_session_reset, subagent_start,
 * subagent_stop, pre_gateway_dispatch, pre_approval_request,
 * post_approval_response, kanban_task_claimed, kanban_task_completed,
 * kanban_task_blocked, on_memory_write.
 *
 * 4 middleware kinds with next_call chain: llm_request, llm_execution,
 * tool_request, tool_execution. Multiple plugins chain in registration
 * order. Middleware failures are fail-open (logged, continue with next).
 *
 * ## Load-bearing rule
 *
 * Plugins MUST NOT modify core files. If a plugin needs more, widen the
 * generic plugin surface — never special-case it in core.
 *
 * @module plugins/registry
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import type { ToolCall } from '../agent/types.js';
import type { Tool } from '../tools/types.js';
import type { Logger } from '../utils/logger.js';

/** All valid hook names. */
export const VALID_HOOKS = new Set([
  'pre_tool_call',
  'post_tool_call',
  'transform_terminal_output',
  'transform_tool_result',
  'transform_llm_output',
  'pre_llm_call',
  'post_llm_call',
  'pre_api_request',
  'post_api_request',
  'api_request_error',
  'on_session_start',
  'on_session_end',
  'on_session_finalize',
  'on_session_reset',
  'subagent_start',
  'subagent_stop',
  'pre_gateway_dispatch',
  'pre_approval_request',
  'post_approval_response',
  'kanban_task_claimed',
  'kanban_task_completed',
  'kanban_task_blocked',
  'on_memory_write',
  // Claude Code-compatible lifecycle hooks (mirrored from tools/hooks/types.ts)
  'session_start',
  'pre_compact',
  'stop',
]);

/**
 * Hooks whose handlers MUST fail-closed on error. If a handler for one
 * of these hooks throws, the entire hook chain is aborted and the
 * calling action is blocked. Informational hooks (e.g., `post_tool_call`)
 * remain fail-open — a thrown handler is logged and the chain continues.
 *
 * Without this distinction, a buggy or malicious `pre_tool_call`
 * hook (e.g., `block_secrets`) that throws would silently let the
 * tool call proceed, defeating the safety gate.
 */
const SECURITY_CRITICAL_HOOKS = new Set([
  'pre_tool_call',
  'pre_approval_request',
  'pre_gateway_dispatch',
  'pre_llm_call',
  'pre_api_request',
]);

/** Middleware kinds. */
export type MiddlewareKind = 'llm_request' | 'llm_execution' | 'tool_request' | 'tool_execution';

/** A hook handler function. */
export type HookHandler = (ctx: HookContext) => void | Promise<void>;

/** Context passed to hook handlers. */
export interface HookContext {
  /** The hook name. */
  hook: string;
  /** The session ID. */
  sessionId?: string;
  /** The tool name (for tool hooks). */
  toolName?: string;
  /** The tool call (for tool hooks). */
  toolCall?: ToolCall;
  /** The tool result (for post_tool_call). */
  toolResult?: string;
  /** The LLM output (for transform_llm_output). */
  llmOutput?: string;
  /** The terminal output (for transform_terminal_output). */
  terminalOutput?: string;
  /** The LLM request params (for pre/post_llm_call). */
  llmRequest?: Record<string, unknown>;
  /** The API request (for pre/post_api_request). */
  apiRequest?: Record<string, unknown>;
  /** Additional data. */
  data?: Record<string, unknown>;
}

/** A middleware handler with next_call chain. */
export type MiddlewareHandler = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

/** Context passed to middleware handlers. */
export interface MiddlewareContext {
  /** The middleware kind. */
  kind: MiddlewareKind;
  /** The session ID. */
  sessionId?: string;
  /** The request data (mutable — middleware can modify). */
  request: Record<string, unknown>;
  /** The response data (mutable — middleware can modify). */
  response?: Record<string, unknown>;
  /** Additional data. */
  data?: Record<string, unknown>;
}

/** A CLI command registered by a plugin. */
export interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string[]) => void | Promise<void>;
  aliases?: string[];
}

/** A registered plugin. */
export interface Plugin {
  /** The plugin name. */
  name: string;
  /** The plugin version. */
  version: string;
  /** The discovery source. */
  source: 'bundled' | 'user' | 'project' | 'npm';
  /** The plugin path. */
  path: string;
  /** Registered tools. */
  tools: Tool[];
  /** Registered commands. */
  commands: PluginCommand[];
  /** Registered hooks (hook name → handlers). */
  hooks: Map<string, HookHandler[]>;
  /** Registered middleware (kind → handlers). */
  middleware: Map<MiddlewareKind, MiddlewareHandler[]>;
  /** Whether the plugin is enabled. */
  enabled: boolean;
}

/** The plugin context — passed to plugin init functions. */
export interface PluginContext {
  /** The plugin name. */
  name: string;
  /** Register a tool. */
  registerTool: (tool: Tool) => void;
  /** Register a CLI command. */
  registerCommand: (command: PluginCommand) => void;
  /** Register a hook handler. */
  registerHook: (hook: string, handler: HookHandler) => void;
  /** Register a middleware handler. */
  registerMiddleware: (kind: MiddlewareKind, handler: MiddlewareHandler) => void;
  /** Get the logger. */
  getLogger: () => Logger | undefined;
}

/** The plugin init function signature. */
export type PluginInit = (ctx: PluginContext) => void | Promise<void>;

/** Options for the PluginRegistry. */
export interface PluginRegistryOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Whether to enable project-level plugins (default: false). */
  enableProjectPlugins?: boolean;
  /** The user plugins directory (default: ~/.goli-cli/plugins/). */
  userPluginsDir?: string;
  /** The project plugins directory (default: ./.goli/plugins/). */
  projectPluginsDir?: string;
}

/**
 * Plugin registry — discovers, loads, and manages plugins.
 *
 * @module plugins/registry
 */
export class PluginRegistry extends EventEmitter {
  private readonly log?: Logger;
  private readonly enableProjectPlugins: boolean;
  private readonly userPluginsDir: string;
  private readonly projectPluginsDir: string;
  private readonly plugins = new Map<string, Plugin>();
  private readonly tools = new Map<string, { tool: Tool; plugin: string }>();
  private readonly commands = new Map<string, { command: PluginCommand; plugin: string }>();
  private readonly hookHandlers = new Map<string, Array<{ handler: HookHandler; plugin: string }>>();
  private readonly middlewareChains = new Map<MiddlewareKind, Array<{ handler: MiddlewareHandler; plugin: string }>>();

  constructor(opts: PluginRegistryOptions = {}) {
    super();
    this.log = opts.logger;
    this.enableProjectPlugins = opts.enableProjectPlugins ?? false;
    this.userPluginsDir = opts.userPluginsDir ?? join(homedir(), '.goli-cli', 'plugins');
    this.projectPluginsDir = opts.projectPluginsDir ?? join(process.cwd(), '.goli', 'plugins');
  }

  /**
   * Discover and load all plugins from all sources.
   *
   * Order: bundled → user → project → npm (later overrides earlier).
   */
  async discoverAndLoad(): Promise<number> {
    let count = 0;

    // 1. Bundled plugins
    count += await this.discoverBundled();

    // 2. User plugins
    count += await this.discoverFromDir(this.userPluginsDir, 'user');

    // 3. Project plugins (opt-in)
    if (this.enableProjectPlugins) {
      count += await this.discoverFromDir(this.projectPluginsDir, 'project');
    }

    // 4. npm entry points (stub — would scan node_modules for goli-cli-plugins)
    // count += await this.discoverNpm();

    this.log?.info('Plugin discovery complete', { totalPlugins: this.plugins.size, sources: count });
    return count;
  }

  /**
   * Load a single plugin from a directory.
   *
   * @param pluginDir - The plugin directory.
   * @param source - The discovery source.
   */
  async loadPlugin(pluginDir: string, source: Plugin['source']): Promise<Plugin | null> {
    const packageJsonPath = join(pluginDir, 'package.json');
    if (!existsSync(packageJsonPath)) return null;

    try {
      const raw = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8'),
      ) as Record<string, unknown>;
      // Validate package.json shape. The previous implementation used
      // `as { name: string; version: string; main?: string }` which is
      // an unchecked cast — a malformed package.json with missing
      // `name`/`version` silently set `name=undefined`, then
      // `this.plugins.set('undefined', plugin)` and `mod[undefined]`
      // (always `undefined`) meant the plugin was silently loaded
      // but never initialized.
      if (typeof raw['name'] !== 'string' || typeof raw['version'] !== 'string') {
        this.log?.error('Plugin package.json missing name or version', { path: packageJsonPath });
        return null;
      }
      const name = raw['name'];
      const version = raw['version'];
      const mainFile = (typeof raw['main'] === 'string' ? raw['main'] : null) ?? 'index.js';
      // Defense in depth: contain the entry point within the plugin
      // directory. The previous implementation used `join(pluginDir,
      // mainFile)` which would follow `../../../etc/...` or absolute
      // paths out of `pluginDir`, letting a normal-looking plugin
      // hide its actual payload in a system path.
      const mainPath = resolve(pluginDir, mainFile);
      const resolvedPluginDir = resolve(pluginDir);
      if (
        !mainPath.startsWith(resolvedPluginDir + sep) &&
        mainPath !== resolvedPluginDir
      ) {
        this.log?.error('Plugin main path escapes plugin directory', {
          pluginDir,
          mainFile,
          mainPath,
        });
        return null;
      }

      if (!existsSync(mainPath)) return null;

      // Create plugin context
      const plugin: Plugin = {
        name,
        version,
        source,
        path: pluginDir,
        tools: [],
        commands: [],
        hooks: new Map(),
        middleware: new Map(),
        enabled: true,
      };

      const ctx: PluginContext = {
        name,
        registerTool: (tool) => {
          plugin.tools.push(tool);
          this.tools.set(tool.name, { tool, plugin: name });
          this.log?.debug('Plugin registered tool', { plugin: name, tool: tool.name });
        },
        registerCommand: (command) => {
          plugin.commands.push(command);
          this.commands.set(command.name, { command, plugin: name });
          this.log?.debug('Plugin registered command', { plugin: name, command: command.name });
        },
        registerHook: (hook, handler) => {
          if (!VALID_HOOKS.has(hook)) {
            this.log?.warn('Plugin tried to register invalid hook', { plugin: name, hook });
            return;
          }
          if (!plugin.hooks.has(hook)) plugin.hooks.set(hook, []);
          plugin.hooks.get(hook)!.push(handler);
          if (!this.hookHandlers.has(hook)) this.hookHandlers.set(hook, []);
          this.hookHandlers.get(hook)!.push({ handler, plugin: name });
          this.log?.debug('Plugin registered hook', { plugin: name, hook });
        },
        registerMiddleware: (kind, handler) => {
          if (!plugin.middleware.has(kind)) plugin.middleware.set(kind, []);
          plugin.middleware.get(kind)!.push(handler);
          if (!this.middlewareChains.has(kind)) this.middlewareChains.set(kind, []);
          this.middlewareChains.get(kind)!.push({ handler, plugin: name });
          this.log?.debug('Plugin registered middleware', { plugin: name, kind });
        },
        getLogger: () => this.log,
      };

      // Load and init the plugin.
      //
      // SECURITY: plugins are loaded via `createRequire`/dynamic
      // `import()` and run with the FULL privileges of the goli-cli
      // process. There is NO permission model, NO capability
      // scoping, NO `vm` sandbox, NO worker_threads isolation. A
      // malicious plugin can read/write any file the process can,
      // make network requests, spawn child processes, and access
      // `process.env` (including API keys).
      //
      // To partially mitigate this, we:
      //   1. Audit-log every plugin load (name, version, source, hash).
      //   2. Default-deny project plugins (enableProjectPlugins=false).
      //   3. Validate the entry point stays within the plugin dir (above).
      //
      // Full hardening (worker_threads + permission manifest +
      // `goli.permissions` field in package.json) is tracked as a
      // follow-up — see CRITICAL finding in the audit.
      const require = createRequire(import.meta.url);
      let mod: Record<string, unknown>;
      try {
        mod = require(mainPath);
      } catch {
        mod = await import(mainPath);
      }
      const initFn = (mod.default ?? mod.init ?? mod[name]) as PluginInit | undefined;
      if (typeof initFn === 'function') {
        await initFn(ctx);
      }

      // Audit-log the load with a content hash of the main file so
      // post-incident forensics can verify which exact code ran.
      let mainHash = 'unknown';
      try {
        const mainContent = readFileSync(mainPath, 'utf-8');
        mainHash = createHash('sha256').update(mainContent).digest('hex').slice(0, 16);
      } catch {
        // Best-effort.
      }
      this.log?.info('Plugin loaded (audited)', {
        name,
        version,
        source,
        mainHash,
        tools: plugin.tools.length,
        commands: plugin.commands.length,
      });

      // Override if plugin with same name already exists
      this.plugins.set(name, plugin);
      return plugin;
    } catch (err) {
      this.log?.error('Failed to load plugin', {
        path: pluginDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Run all hook handlers for a given hook.
   *
   * Handlers run in registration order. Errors are caught and logged
   * (fail-open) for informational hooks, but **fail-closed** for
   * security-critical hooks (`pre_tool_call`, `pre_approval_request`,
   * `pre_gateway_dispatch`, `pre_llm_call`, `pre_api_request`).
   * The previous blanket fail-open policy meant a malicious or
   * buggy `pre_tool_call` hook (e.g., `block_secrets`) that threw
   * would silently let the tool call proceed, defeating the safety
   * gate.
   * @param hook
   * @param ctx
   */
  async runHook(hook: string, ctx: HookContext): Promise<void> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers) return;

    const isSecurityCritical = SECURITY_CRITICAL_HOOKS.has(hook);
    for (const { handler, plugin } of handlers) {
      try {
        await handler({ ...ctx, hook });
      } catch (err) {
        if (isSecurityCritical) {
          this.log?.error('Security-critical hook failed (fail-closed)', {
            plugin,
            hook,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err; // fail-closed — re-throw to abort the action.
        }
        this.log?.warn('Plugin hook handler failed (fail-open)', {
          plugin,
          hook,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Run a middleware chain.
   *
   * Middleware handlers chain in registration order via next_call.
   * Errors are caught and logged (fail-open).
   * @param kind
   * @param ctx
   */
  async runMiddleware(kind: MiddlewareKind, ctx: MiddlewareContext): Promise<void> {
    const chain = this.middlewareChains.get(kind);
    if (!chain || chain.length === 0) return;

    let index = 0;
    const runNext = async (): Promise<void> => {
      if (index >= chain.length) return;
      const { handler, plugin } = chain[index]!;
      index++;
      try {
        await handler(ctx, runNext);
      } catch (err) {
        this.log?.warn('Plugin middleware failed (fail-open)', {
          plugin,
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue to next middleware (fail-open)
        await runNext();
      }
    };

    await runNext();
  }

  /**
   * Get all registered tools from plugins.
   */
  getTools(): Tool[] {
    return [...this.tools.values()].map((t) => t.tool);
  }

  /**
   * Get a tool by name.
   * @param name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * Get all registered commands from plugins.
   */
  getCommands(): PluginCommand[] {
    return [...this.commands.values()].map((c) => c.command);
  }

  /**
   * Dispatch a command by name.
   * @param name
   * @param args
   */
  async dispatchCommand(name: string, args: string[]): Promise<boolean> {
    const entry = this.commands.get(name);
    if (!entry) return false;
    try {
      await entry.command.handler(args);
      return true;
    } catch (err) {
      this.log?.error('Plugin command failed', {
        command: name,
        plugin: entry.plugin,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Get all loaded plugins.
   */
  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Enable a plugin.
   *
   * The previous implementation only set `plugin.enabled = true` —
   * it did NOT re-add the disabled plugin's tools, commands, hooks,
   * and middleware to the active registries. After a disable→enable
   * cycle, the plugin appeared enabled but none of its
   * tools/hooks worked. We now re-register everything on enable
   * so the round-trip is lossless.
   * @param name
   */
  enable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    if (plugin.enabled) return true; // already enabled — no-op
    plugin.enabled = true;

    // Re-register tools.
    for (const tool of plugin.tools) {
      this.tools.set(tool.name, { tool, plugin: name });
    }
    // Re-register commands.
    for (const cmd of plugin.commands) {
      this.commands.set(cmd.name, { command: cmd, plugin: name });
    }
    // Re-register hooks.
    for (const [hook, handlers] of plugin.hooks) {
      const existing = this.hookHandlers.get(hook) ?? [];
      for (const handler of handlers) {
        existing.push({ handler, plugin: name });
      }
      this.hookHandlers.set(hook, existing);
    }
    // Re-register middleware.
    for (const [kind, chain] of plugin.middleware) {
      const existing = this.middlewareChains.get(kind) ?? [];
      for (const handler of chain) {
        existing.push({ handler, plugin: name });
      }
      this.middlewareChains.set(kind, existing);
    }
    return true;
  }

  /**
   * Disable a plugin (its tools, commands, hooks, and middleware are
   * removed from the active registries).
   * @param name
   */
  disable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = false;

    // Remove tools
    for (const tool of plugin.tools) {
      this.tools.delete(tool.name);
    }
    // Remove commands
    for (const cmd of plugin.commands) {
      this.commands.delete(cmd.name);
    }
    // Remove hooks
    for (const [hook, handlers] of this.hookHandlers.entries()) {
      this.hookHandlers.set(hook, handlers.filter((h) => h.plugin !== name));
    }
    // Remove middleware
    for (const [kind, chain] of this.middlewareChains.entries()) {
      this.middlewareChains.set(kind, chain.filter((m) => m.plugin !== name));
    }

    return true;
  }

  /**
   * Get the total plugin count.
   */
  get count(): number {
    return this.plugins.size;
  }

  // ─── Discovery helpers ──────────────────────────────────────────

  /** Discover bundled plugins. */
  private async discoverBundled(): Promise<number> {
    // Stub — bundled plugins would be in packages/core/src/plugins/builtin/
    return 0;
  }

  /**
   * Discover plugins from a directory.
   * @param dir
   * @param source
   */
  private async discoverFromDir(dir: string, source: Plugin['source']): Promise<number> {
    if (!existsSync(dir)) return 0;

    let count = 0;
    // Sort entries alphabetically so the "later overrides earlier"
    // rule for same-named plugins is deterministic across
    // filesystems. The previous implementation used raw
    // `readdirSync(dir)` which returns entries in filesystem
    // order — on ext4 vs APFS vs NTFS, the same directory could
    // yield different orders, causing different plugins to win
    // the override race.
    const entries = readdirSync(dir).sort();

    for (const entry of entries) {
      const pluginDir = join(dir, entry);
      // The previous implementation used
      // `statSync(pluginDir).isDirectory()` which throws if the
      // entry is inaccessible (permissions, broken symlink, etc.).
      // There was no try/catch, so one bad entry crashed the entire
      // discovery loop, preventing subsequent plugins from loading.
      // We now catch stat errors and skip the bad entry.
      try {
        if (!statSync(pluginDir).isDirectory()) continue;
      } catch (err) {
        this.log?.warn('Skipping inaccessible plugin entry', {
          dir: pluginDir,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const plugin = await this.loadPlugin(pluginDir, source);
      if (plugin) count++;
    }

    return count;
  }
}

/** The singleton plugin registry. */
export const pluginRegistry = new PluginRegistry();
