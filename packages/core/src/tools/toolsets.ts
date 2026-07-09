/**
 * Toolset composition (Hermes pattern).
 *
 * `TOOLSETS` dict: each entry has `description`, `tools` (list of tool
 * names), `includes` (other toolset names to compose). Compose
 * `debugging = terminal + process + web + file`.
 *
 * @module tools/toolsets
 */

/** A toolset definition. */
export interface Toolset {
  /** The toolset name (e.g. 'coding', 'debugging', 'safe'). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Tool names in this toolset. */
  tools: string[];
  /** Other toolset names to include (composition). */
  includes?: string[];
}

/** The shared core tools bundle every platform inherits. */
export const CORE_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'grep',
  'bash',
  'plan_task',
];

/** The toolset registry. */
export const TOOLSETS: Record<string, Toolset> = {
  core: {
    name: 'core',
    description: 'Core tools every agent has',
    tools: [...CORE_TOOLS],
  },

  coding: {
    name: 'coding',
    description: 'Coding tools for software development',
    tools: [...CORE_TOOLS],
    includes: ['file_ops'],
  },

  file_ops: {
    name: 'file_ops',
    description: 'File operations',
    tools: ['read_file', 'write_file', 'edit_file', 'list_directory'],
  },

  search: {
    name: 'search',
    description: 'Search and retrieval tools',
    tools: ['grep'],
    includes: ['file_ops'],
  },

  terminal: {
    name: 'terminal',
    description: 'Terminal/shell execution',
    tools: ['bash'],
  },

  debugging: {
    name: 'debugging',
    description: 'Debugging tools',
    tools: [],
    includes: ['terminal', 'search', 'file_ops'],
  },

  safe: {
    name: 'safe',
    description: 'Read-only safe tools (no mutations)',
    tools: ['read_file', 'list_directory', 'grep'],
  },

  full: {
    name: 'full',
    description: 'All available tools',
    tools: [...CORE_TOOLS],
    includes: ['coding', 'debugging'],
  },
};

/**
 * Resolve a toolset to its full list of tool names (expanding includes).
 *
 * @param toolsetName - The toolset name.
 * @returns Array of tool names (deduplicated).
 */
export function resolveToolset(toolsetName: string): string[] {
  const toolset = TOOLSETS[toolsetName];
  if (!toolset) return [];

  const tools = new Set<string>(toolset.tools);

  // Recursively expand includes
  const expandIncludes = (ts: Toolset): void => {
    if (!ts.includes) return;
    for (const include of ts.includes) {
      const included = TOOLSETS[include];
      if (!included) continue;
      for (const tool of included.tools) {
        tools.add(tool);
      }
      expandIncludes(included);
    }
  };

  expandIncludes(toolset);
  return [...tools];
}

/**
 * Get tool definitions for a toolset.
 *
 * @param toolsetName - The toolset name.
 * @param registry - The tool registry to look up definitions.
 * @param registry.get
 * @returns Array of ToolDefinition.
 */
export function getToolsetDefinitions(
  toolsetName: string,
  registry: { get: (name: string) => Tool | undefined },
): ToolDefinition[] {
  const toolNames = resolveToolset(toolsetName);
  const defs: ToolDefinition[] = [];

  for (const name of toolNames) {
    const tool = registry.get(name);
    if (tool) {
      defs.push({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      });
    }
  }

  return defs;
}

/** List all toolset names. */
export function listToolsets(): string[] {
  return Object.keys(TOOLSETS);
}

// Type import for ToolDefinition
import type { Tool, ToolDefinition } from './types.js';
