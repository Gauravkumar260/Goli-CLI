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

import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, "utf-8"),
      ) as { name: string; version: string; main?: string };

      const name = packageJson.name;
      const version = packageJson.version;
      const mainFile = packageJson.main ?? 'index.js';
      const mainPath = join(pluginDir, mainFile);

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

      // Load and init the plugin
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

      // Override if plugin with same name already exists
      this.plugins.set(name, plugin);
      this.log?.info('Plugin loaded', { name, version, source, tools: plugin.tools.length, commands: plugin.commands.length });
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
   * (fail-open — don't let a plugin hook crash the agent).
   * @param hook
   * @param ctx
   */
  async runHook(hook: string, ctx: HookContext): Promise<void> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers) return;

    for (const { handler, plugin } of handlers) {
      try {
        await handler({ ...ctx, hook });
      } catch (err) {
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
   * @param name
   */
  enable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = true;
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
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const pluginDir = join(dir, entry);
      if (!statSync(pluginDir).isDirectory()) continue;

      const plugin = await this.loadPlugin(pluginDir, source);
      if (plugin) count++;
    }

    return count;
  }
}

/** The singleton plugin registry. */
export const pluginRegistry = new PluginRegistry();
