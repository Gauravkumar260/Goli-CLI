/**
 * Footprint Ladder — decision framework for "where does new capability go?"
 *
 * Hermes-agent pattern (source-verified from hermes-agent-main/AGENTS.md).
 * Adopted for Goli-CLI in T-027.
 *
 * ## The Ladder (from lowest to highest footprint)
 *
 * When adding a new capability, choose the LOWEST rung that meets the need:
 *
 * 1. **EXTEND an existing tool** (footprint: 0 new files)
 *    - Add a new flag/option/subcommand to an existing tool.
 *    - Example: adding `--regex` flag to `grep` tool.
 *    - When to use: the new capability is a natural extension of an existing
 *      tool's purpose.
 *
 * 2. **CLI subcommand + skill** (footprint: 1 CLI file + 1 SKILL.md)
 *    - Add a `goli <cmd>` subcommand that orchestrates existing tools via a
 *      SKILL.md prompt template.
 *    - Example: `goli init` orchestrates read_file + write_file + spec-write.
 *    - When to use: the capability is a multi-step workflow that uses
 *      existing tools in a specific order.
 *
 * 3. **SERVICE-GATED TOOL** (footprint: 1 tool file; 0 schema cost when
 *    prereq not configured)
 *    - Register a tool with a `check_fn` that returns false unless the
 *      prerequisite is configured (env var, dep installed, file present).
 *    - The tool only appears in the LLM's schema when the prereq is met.
 *    - Example: a `vision_analyze` tool that only appears when
 *      `GOLI_VISION_ENDPOINT` is set.
 *    - When to use: the capability requires an external service/dep that
 *      not all users have. Avoids cluttering the LLM's schema for users
 *      who can't use it.
 *
 * 4. **PLUGIN** (footprint: 1 file in `~/.goli/plugins/`)
 *    - A user-installed module that registers tools, hooks, or CLI
 *      subcommands at startup.
 *    - Example: a Jira plugin that adds a `jira_create_issue` tool.
 *    - When to use: the capability is user-specific or org-specific and
 *      shouldn't ship in core.
 *
 * 5. **MCP SERVER** (footprint: 0 in core; user runs `goli mcp add`)
 *    - An external process exposing tools via Model Context Protocol.
 *    - Goli-CLI connects to it as a client; the tools appear in the schema.
 *    - Example: a Postgres MCP server that adds `pg_query` + `pg_schema` tools.
 *    - When to use: the capability has its own runtime (Python, Rust, etc.)
 *      or needs to run in a separate process for isolation.
 *
 * 6. **CORE TOOL** (footprint: 1 file in `packages/tool-system/src/core/`)
 *    - A tool that ships with goli-cli core and is always available.
 *    - Example: `read_file`, `write_file`, `bash`, `grep`.
 *    - When to use: the capability is needed by virtually every user and
 *      cannot be provided by a lower rung. THIS IS THE HIGHEST FOOTPRINT —
 *      avoid unless necessary.
 *
 * ## Why the ladder matters
 *
 * Every tool in the LLM's schema has a cost:
 * - Token cost (each tool definition consumes context window budget).
 * - Cognitive cost (the LLM must consider each tool when planning).
 * - Maintenance cost (each core tool must be tested, documented, secured).
 *
 * By choosing the lowest rung, we keep the core schema narrow, the LLM
 * focused, and the maintenance burden sustainable.
 *
 * ## How to choose
 *
 * Ask these questions in order:
 * 1. Can an existing tool do this with a new flag? → **rung 1 (extend)**
 * 2. Is this a workflow that orchestrates existing tools? → **rung 2 (CLI + skill)**
 * 3. Does this need an external service not all users have? → **rung 3 (service-gated)**
 * 4. Is this user/org-specific? → **rung 4 (plugin)**
 * 5. Does this need a separate runtime/isolation? → **rung 5 (MCP server)**
 * 6. Is this needed by virtually every user? → **rung 6 (core tool)**
 *
 * If you reach step 6, justify why the lower rungs are insufficient in your
 * PR description.
 *
 * ## Classification of existing goli-cli tools (21 tools)
 *
 * All 21 existing core tools are at **rung 6 (core)** by definition. They
 * were placed there before the Footprint Ladder was adopted (T-027). Future
 * audits may downgrade some to rung 3 (service-gated) where appropriate.
 *
 * | Tool | Current | Recommended | Notes |
 * |------|---------|-------------|-------|
 * | read_file | 6 (core) | 6 | Universal need. |
 * | write_file | 6 (core) | 6 | Universal need. |
 * | edit_file | 6 (core) | 6 | Universal need. |
 * | bash | 6 (core) | 6 | Universal need. |
 * | grep | 6 (core) | 6 | Universal need; backed by ripgrep. |
 * | list_directory | 6 (core) | 6 | Universal need. |
 * | web_fetch | 6 (core) | 3 (service-gated) | Could gate on GOLI_WEB_FETCH=1. |
 * | web_search | 6 (core) | 3 (service-gated) | Could gate on GOLI_WEB_SEARCH=1. |
 * | ask_user | 6 (core) | 6 | Universal need. |
 * | todo_write | 6 (core) | 6 | Universal need. |
 * | spawn_subagent | 6 (core) | 6 | Universal need. |
 * | background_shell | 6 (core) | 6 | Universal need. |
 * | notebook_edit | 6 (core) | 3 (service-gated) | Only useful if Jupyter installed. |
 * | lsp_tools | 6 (core) | 3 (service-gated) | Only useful if LSP server running. |
 * | spec_review | 6 (core) | 2 (CLI + skill) | Could be a `goli spec-review` subcommand. |
 * | spec_write | 6 (core) | 2 (CLI + skill) | Could be a `goli spec-write` subcommand. |
 * | spec_update | 6 (core) | 2 (CLI + skill) | Could be a `goli spec-update` subcommand. |
 * | spec_registry | 6 (core) | 2 (CLI + skill) | Could be a `goli spec-registry` subcommand. |
 * | tool_streaming | 6 (core) | 6 | Internal infra. |
 * | path_safety | 6 (core) | 6 | Internal infra (not a user-facing tool). |
 * | diff_utils | 6 (core) | 6 | Internal infra. |
 *
 * ## Service-gated tool pattern (rung 3 implementation)
 *
 * To create a service-gated tool, add an optional `check_fn` to the tool
 * definition. The ToolRegistry will exclude the tool from the LLM schema
 * when `check_fn` returns false.
 *
 * ```ts
 * const visionTool: ToolDefinition = {
 *   name: 'vision_analyze',
 *   description: 'Analyze an image.',
 *   inputSchema: { ... },
 *   handler: async (args) => { ... },
 *   check_fn: () => Boolean(process.env.GOLI_VISION_ENDPOINT),
 * };
 * ```
 *
 * T-020 will implement the `check_fn` plumbing in the ToolRegistry.
 *
 * @module tools/footprint-ladder
 */

/**
 * The 6 rungs of the Footprint Ladder, from lowest to highest footprint.
 */
export const FOOTPRINT_LADDER_RUNGS = [
  'extend',
  'cli_skill',
  'service_gated_tool',
  'plugin',
  'mcp_server',
  'core_tool',
] as const;

/** A rung on the Footprint Ladder. */
export type FootprintLadderRung = (typeof FOOTPRINT_LADDER_RUNGS)[number];

/** Human-readable description of each rung. */
export const RUNG_DESCRIPTIONS: Record<FootprintLadderRung, string> = {
  extend: 'EXTEND an existing tool with a new flag/option (0 new files).',
  cli_skill: 'CLI subcommand + SKILL.md prompt template (1 CLI file + 1 SKILL.md).',
  service_gated_tool:
    'Tool with check_fn — appears in schema only when prereq configured (1 file, 0 schema cost when gated).',
  plugin: 'User-installed module in ~/.goli/plugins/ (1 file, not in core).',
  mcp_server: 'External MCP server process (0 in core; user runs `goli mcp add`).',
  core_tool: 'Always-available tool in packages/tool-system/src/core/ (highest footprint).',
};

/**
 * Classify a tool against the Footprint Ladder.
 *
 * @param rung - The rung to classify.
 * @returns The human-readable description.
 */
export function describeRung(rung: FootprintLadderRung): string {
  return RUNG_DESCRIPTIONS[rung];
}

/**
 * Determine the recommended rung for a new capability based on its
 * characteristics.
 *
 * @param opts - Capability characteristics.
 * @returns The recommended rung.
 */
export function recommendRung(opts: {
  /** True if an existing tool can do this with a new flag. */
  canExtendExistingTool?: boolean;
  /** True if this is a multi-step workflow using existing tools. */
  isWorkflow?: boolean;
  /** True if this needs an external service not all users have. */
  needsExternalService?: boolean;
  /** True if this is user/org-specific. */
  isUserSpecific?: boolean;
  /** True if this needs a separate runtime/isolation. */
  needsSeparateRuntime?: boolean;
  /** True if virtually every user needs this. */
  universallyNeeded?: boolean;
}): FootprintLadderRung {
  if (opts.canExtendExistingTool) {
    return 'extend';
  }
  if (opts.isWorkflow) {
    return 'cli_skill';
  }
  if (opts.needsExternalService) {
    return 'service_gated_tool';
  }
  if (opts.isUserSpecific) {
    return 'plugin';
  }
  if (opts.needsSeparateRuntime) {
    return 'mcp_server';
  }
  if (opts.universallyNeeded) {
    return 'core_tool';
  }
  // Default: lowest-footprint rung that fits none of the above is 'extend'
  // (meaning: revisit whether you can extend something first).
  return 'extend';
}

/**
 * Existing tool classification (T-027 audit).
 *
 * All 21 core tools are currently at rung 6 (core_tool). The `recommended`
 * field suggests a lower rung where appropriate for future audits.
 */
export interface ToolClassification {
  name: string;
  current: FootprintLadderRung;
  recommended: FootprintLadderRung;
  notes: string;
}

/** The classification table for all 21 existing core tools.
 *
 * MEDIUM-26: the previous table listed `spec_registry` TWICE (rows
 * 18 and 22), inflating the count to 22. The duplicate is removed.
 */
export const TOOL_CLASSIFICATIONS: ToolClassification[] = [
  { name: 'read_file', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'write_file', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'edit_file', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'bash', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'grep', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need; backed by ripgrep.' },
  { name: 'list_directory', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'web_fetch', current: 'core_tool', recommended: 'service_gated_tool', notes: 'Could gate on GOLI_WEB_FETCH=1.' },
  { name: 'web_search', current: 'core_tool', recommended: 'service_gated_tool', notes: 'Could gate on GOLI_WEB_SEARCH=1.' },
  { name: 'ask_user', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'todo_write', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'spawn_subagent', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'background_shell', current: 'core_tool', recommended: 'core_tool', notes: 'Universal need.' },
  { name: 'notebook_edit', current: 'core_tool', recommended: 'service_gated_tool', notes: 'Only useful if Jupyter installed.' },
  { name: 'lsp_tools', current: 'core_tool', recommended: 'service_gated_tool', notes: 'Only useful if LSP server running.' },
  { name: 'spec_review', current: 'core_tool', recommended: 'cli_skill', notes: 'Could be a `goli spec-review` subcommand.' },
  { name: 'spec_write', current: 'core_tool', recommended: 'cli_skill', notes: 'Could be a `goli spec-write` subcommand.' },
  { name: 'spec_update', current: 'core_tool', recommended: 'cli_skill', notes: 'Could be a `goli spec-update` subcommand.' },
  { name: 'spec_registry', current: 'core_tool', recommended: 'cli_skill', notes: 'Could be a `goli spec-registry` subcommand.' },
  { name: 'tool_streaming', current: 'core_tool', recommended: 'core_tool', notes: 'Internal infra.' },
  { name: 'path_safety', current: 'core_tool', recommended: 'core_tool', notes: 'Internal infra (not user-facing).' },
  { name: 'diff_utils', current: 'core_tool', recommended: 'core_tool', notes: 'Internal infra.' },
];

/**
 * Get the count of tools at each rung (current vs recommended).
 *
 * @returns A summary object.
 */
export function classifyAllTools(): {
  current: Record<FootprintLadderRung, number>;
  recommended: Record<FootprintLadderRung, number>;
  total: number;
} {
  const current = Object.fromEntries(FOOTPRINT_LADDER_RUNGS.map((r) => [r, 0])) as Record<
    FootprintLadderRung,
    number
  >;
  const recommended = Object.fromEntries(FOOTPRINT_LADDER_RUNGS.map((r) => [r, 0])) as Record<
    FootprintLadderRung,
    number
  >;
  for (const t of TOOL_CLASSIFICATIONS) {
    current[t.current]! += 1;
    recommended[t.recommended]! += 1;
  }
  return { current, recommended, total: TOOL_CLASSIFICATIONS.length };
}
