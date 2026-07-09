/**
 * Dynamic tool manager (Module 3, next-gen tool layer).
 *
 * Lets the agent create new tools on the fly. When the agent writes a
 * script via bash or execute_code, it can "save" it as a persistent
 * tool. The manager registers the script in the tool registry with an
 * auto-generated schema, making it available for future calls.
 *
 * This is the Voyager pattern (Wang et al., 2023): the agent writes
 * code to interact with its environment, verifies it works, and stores
 * it in a skill library for later reuse.
 *
 * ## Integration
 *
 * The agent uses a new `save_tool` tool to persist a script:
 *
 * ```json
 * {
 *   "name": "parse_logs",
 *   "description": "Parse nginx access logs and return top IPs",
 *   "language": "python",
 *   "code": "import sys; ...",
 *   "args": [{"name": "file_path", "type": "string", "description": "Log file path"}]
 * }
 * ```
 *
 * The DynamicToolManager:
 *   1. Writes the script to `~/.goli-cli/dynamic-tools/<name>.<ext>`.
 *   2. Creates a Tool definition with the generated schema.
 *   3. Registers it in the ToolRegistry.
 *   4. Future calls to the tool execute the script with the args.
 *
 * @module tools/dynamic-tool-manager
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Tool, ToolResult, ToolContext } from './types.js';
import type { Logger } from '../utils/logger.js';

/** Options for the DynamicToolManager. */
export interface DynamicToolManagerOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Directory to store dynamic tool scripts. */
  toolsDir?: string;
}

/** A dynamic tool definition (persisted to disk). */
interface DynamicToolDef {
  /** The tool name (kebab-case). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** The scripting language ('python' | 'bash' | 'node'). */
  language: 'python' | 'bash' | 'node';
  /** The script source code. */
  code: string;
  /** Argument definitions. */
  args: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
  }>;
  /** When the tool was created (ISO 8601). */
  createdAt: string;
}

/**
 * Manages dynamically-created tools.
 *
 * Usage:
 * ```ts
 * const manager = new DynamicToolManager({ logger });
 * const tool = manager.createTool({
 *   name: 'parse-logs',
 *   description: 'Parse nginx logs',
 *   language: 'python',
 *   code: '...',
 *   args: [{ name: 'file_path', type: 'string', description: 'Log file', required: true }],
 * });
 * registry.register(tool);
 * ```
 */
export class DynamicToolManager {
  private readonly log?: Logger;
  private readonly toolsDir: string;
  private readonly tools = new Map<string, DynamicToolDef>();

  constructor(opts: DynamicToolManagerOptions = {}) {
    this.log = opts.logger;
    this.toolsDir = opts.toolsDir ?? join(homedir(), '.goli-cli', 'dynamic-tools');
    this.loadExistingTools();
  }

  /**
   * Create a new dynamic tool from a script.
   *
   * @param def - The tool definition.
   * @returns The Tool object, ready to register in the ToolRegistry.
   */
  createTool(def: Omit<DynamicToolDef, 'createdAt'>): Tool {
    const fullDef: DynamicToolDef = {
      ...def,
      createdAt: new Date().toISOString(),
    };

    // Persist the tool definition + script to disk.
    this.persistTool(fullDef);

    // Store in memory.
    this.tools.set(fullDef.name, fullDef);

    // Build the Tool object.
    const tool = this.buildToolObject(fullDef);

    this.log?.info('Dynamic tool created', {
      name: fullDef.name,
      language: fullDef.language,
      args: fullDef.args.length,
    });

    return tool;
  }

  /**
   * List all dynamic tools.
   */
  list(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Check if a dynamic tool exists.
   * @param name
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Delete a dynamic tool.
   * @param name
   */
  delete(name: string): boolean {
    if (!this.tools.has(name)) return false;
    this.tools.delete(name);
    try {
      unlinkSync(join(this.toolsDir, `${name}.json`));
      unlinkSync(join(this.toolsDir, `${name}.${this.getExtension(this.tools.get(name)?.language ?? 'bash')}`));
    } catch {
      // Best-effort.
    }
    return true;
  }

  // ─── Internal helpers ──────────────────────────────────────────

  /**
   * Load existing dynamic tools from disk (on startup).
   */
  private loadExistingTools(): void {
    if (!existsSync(this.toolsDir)) return;
    try {
      const files = readdirSync(this.toolsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.toolsDir, file), 'utf-8');
          const def = JSON.parse(raw) as DynamicToolDef;
          this.tools.set(def.name, def);
        } catch {
          // Skip malformed files.
        }
      }
      this.log?.debug('Loaded dynamic tools', { count: this.tools.size });
    } catch {
      // Best-effort.
    }
  }

  /**
   * Persist a tool definition to disk.
   * @param def
   */
  private persistTool(def: DynamicToolDef): void {
    mkdirSync(this.toolsDir, { recursive: true });
    // Save the definition as JSON.
    writeFileSync(join(this.toolsDir, `${def.name}.json`), JSON.stringify(def, null, 2), 'utf-8');
    // Save the script.
    const ext = this.getExtension(def.language);
    writeFileSync(join(this.toolsDir, `${def.name}.${ext}`), def.code, 'utf-8');
  }

  /**
   * Build a Tool object from a dynamic tool definition.
   * @param def
   */
  private buildToolObject(def: DynamicToolDef): Tool {
    // Build the input schema from the arg definitions.
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const arg of def.args) {
      properties[arg.name] = {
        type: arg.type,
        description: arg.description,
      };
      if (arg.required) required.push(arg.name);
    }

    return {
      name: def.name,
      description: def.description,
      inputSchema: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false,
      },
      handler: (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        return this.executeDynamicTool(def, args, ctx);
      },
      tier: 'T1',
      readOnly: false,
    };
  }

  /**
   * Execute a dynamic tool by running its script.
   * @param def
   * @param args
   * @param ctx
   */
  private async executeDynamicTool(
    def: DynamicToolDef,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const ext = this.getExtension(def.language);
    const scriptPath = join(this.toolsDir, `${def.name}.${ext}`);

    if (!existsSync(scriptPath)) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `Dynamic tool script not found: ${scriptPath}`,
      };
    }

    try {
      // Build command args from the tool arguments.
      const cmdArgs: string[] = [];
      for (const arg of def.args) {
        const val = args[arg.name];
        if (val !== undefined) {
          cmdArgs.push(`--${arg.name}`, String(val));
        }
      }

      // Execute the script.
      let binary: string;
      let execArgs: string[];
      switch (def.language) {
        case 'python':
          binary = 'python3';
          execArgs = [scriptPath, ...cmdArgs];
          break;
        case 'node':
          binary = 'node';
          execArgs = [scriptPath, ...cmdArgs];
          break;
        case 'bash':
          binary = 'bash';
          execArgs = [scriptPath, ...cmdArgs];
          break;
      }

      const stdout = execFileSync(binary, execArgs, {
        cwd: ctx.workspaceRoot,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: stdout || '(no output)',
      };
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `Dynamic tool "${def.name}" failed: ${stderr}`,
      };
    }
  }

  /**
   * Get the file extension for a language.
   * @param language
   */
  private getExtension(language: string): string {
    switch (language) {
      case 'python': return 'py';
      case 'node': return 'js';
      case 'bash': return 'sh';
      default: return 'sh';
    }
  }
}

/**
 * The `save_tool` tool — lets the agent create new dynamic tools.
 *
 * When the agent writes a script and wants to persist it for reuse,
 * it calls this tool with the script source and argument definitions.
 */
export const SAVE_TOOL_TOOL: Tool = {
  name: 'save_tool',
  description:
    'Save a script as a reusable tool. Use this when you\'ve written a script that you\'ll ' +
    'need to call repeatedly. The tool is persisted and available for future calls in this session.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The tool name (kebab-case, e.g. "parse-logs").',
      },
      description: {
        type: 'string',
        description: 'A description of what the tool does.',
      },
      language: {
        type: 'string',
        enum: ['python', 'bash', 'node'],
        description: 'The scripting language.',
      },
      code: {
        type: 'string',
        description: 'The script source code. Arguments are passed as --name value on the command line.',
      },
      args: {
        type: 'array',
        description: 'Argument definitions for the tool.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Argument name.' },
            type: { type: 'string', enum: ['string', 'number', 'boolean'], description: 'Argument type.' },
            description: { type: 'string', description: 'What the argument is for.' },
            required: { type: 'boolean', description: 'Whether the argument is required.' },
          },
          required: ['name', 'type', 'description', 'required'],
        },
      },
    },
    required: ['name', 'description', 'language', 'code'],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    // This is a stub handler — the real registration happens in the
    // agent loop, which has access to the DynamicToolManager instance.
    // The loop intercepts save_tool calls and delegates to the manager.
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Tool "${args['name']}" saved. It will be available for future calls.`,
    };
  },
  tier: 'T0',
  readOnly: true,
};
