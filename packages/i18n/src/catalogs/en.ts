/**
 * English locale catalog (the source of truth — all keys defined here first).
 *
 * Keys are namespaced by category: `app.*`, `common.*`, `cli.*`, `cmd.*`,
 * `error.*`, `phase.*`, `a11y.*`.
 *
 * @module i18n/catalogs/en
 */

import type { Catalog } from '../types.js';

/**
 *
 */
export const en: Catalog = {
  // ─── App metadata ──────────────────────────────────────────────
  'app.name': 'goli-cli',
  'app.tagline': 'Multi-Agent Software Swarm',
  'app.version_label': 'version',
  'app.description': 'A production-grade, multi-agent software engineering tool.',

  // ─── Common words ──────────────────────────────────────────────
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.error': 'Error',
  'common.warning': 'Warning',
  'common.success': 'Success',
  'common.info': 'Info',
  'common.loading': 'Loading...',
  'common.done': 'Done',
  'common.retry': 'Retry',
  'common.skip': 'Skip',
  'common.abort': 'Abort',
  'common.continue': 'Continue',
  'common.unknown': 'Unknown',

  // ─── CLI flags + help ──────────────────────────────────────────
  'cli.help_flag': 'Show help',
  'cli.version_flag': 'Show version',
  'cli.interactive_flag': 'Start the full interactive TUI',
  'cli.demo_flag': 'Run in demo mode (no LLM required)',
  'cli.model_flag': 'Model ID to use for this session',
  'cli.god_flag': 'Bypass all safety gates (use with extreme caution)',
  'cli.auto_flag': 'Auto-approve Tier 2 (Risky) actions',
  'cli.sandbox_flag': 'Sandbox mode: read-only | workspace-write | danger-full-access',
  'cli.effort_flag': 'Reasoning effort: low | high | max',
  'cli.debug_flag': 'Enable debug logging',
  'cli.print_flag': 'Headless mode: run and print result to stdout',
  'cli.output_format_flag': 'Output format: text | json | stream-json',
  'cli.prompt_flag': 'Prompt text (or "-" for stdin)',

  // ─── Command: doctor ───────────────────────────────────────────
  'cmd.doctor.title': 'GOLI-CLI Doctor — Environment Health Check',
  'cmd.doctor.checking': 'Checking',
  'cmd.doctor.node_version': 'Node.js version',
  'cmd.doctor.ripgrep': 'ripgrep (rg) installed',
  'cmd.doctor.git': 'git installed',
  'cmd.doctor.model_endpoint': 'Model endpoint reachable',
  'cmd.doctor.goli_md': 'GOLI.md project memory file exists',
  'cmd.doctor.config_dir_writable': '~/.goli-cli/ directory is writable',
  'cmd.doctor.all_pass': 'All checks passed',
  'cmd.doctor.some_fail': 'Some checks failed',

  // ─── Command: status ───────────────────────────────────────────
  'cmd.status.title': 'GOLI-CLI Status',
  'cmd.status.active_sessions': 'Active sessions',
  'cmd.status.uptime': 'Uptime',
  'cmd.status.memory_usage': 'Memory usage',

  // ─── Command: usage ────────────────────────────────────────────
  'cmd.usage.title': 'GOLI-CLI Usage',
  'cmd.usage.tokens_used': 'Tokens used',
  'cmd.usage.cost': 'Cost',
  'cmd.usage.sessions': 'Sessions',

  // ─── Command: cron ─────────────────────────────────────────────
  'cmd.cron.title': 'Scheduled Jobs',
  'cmd.cron.add': 'Add a scheduled job',
  'cmd.cron.list': 'List scheduled jobs',
  'cmd.cron.remove': 'Remove a scheduled job',
  'cmd.cron.pause': 'Pause a scheduled job',
  'cmd.cron.resume': 'Resume a paused job',

  // ─── Command: init ─────────────────────────────────────────────
  'cmd.init.title': 'Initialize GOLI.md',
  'cmd.init.created': 'Created GOLI.md',
  'cmd.init.exists': 'GOLI.md already exists',

  // ─── Command: mcp ──────────────────────────────────────────────
  'cmd.mcp.title': 'MCP Server Management',
  'cmd.mcp.add': 'Add an MCP server',
  'cmd.mcp.list': 'List MCP servers',
  'cmd.mcp.remove': 'Remove an MCP server',

  // ─── Errors ────────────────────────────────────────────────────
  'error.no_prompt': 'Error: -p flag requires a prompt (or "-" to read from stdin)',
  'error.invalid_output_format': 'Error: invalid --output-format "{format}". Must be: text | json | stream-json',
  'error.generic': 'Error: {message}',
  'error.unknown_command': 'Error: unknown command "{command}"',
  'error.missing_dependency': 'Error: missing dependency "{dep}"',
  'error.permission_denied': 'Error: permission denied',
  'error.network_unreachable': 'Error: network unreachable',
  'error.timeout': 'Error: operation timed out after {seconds}s',

  // ─── Phases (used by demo mode + agent loop) ───────────────────
  'phase.init': 'INIT',
  'phase.plan': 'PLAN',
  'phase.tool': 'TOOL',
  'phase.gen': 'GEN',
  'phase.done': 'DONE',
  'phase.init_description': 'Initializing agent swarm',
  'phase.plan_description': 'Planning task decomposition',
  'phase.tool_description': 'Executing tool calls',
  'phase.gen_description': 'Generating response',
  'phase.done_description': 'Task complete',

  // ─── Accessibility (screen-reader labels, contrast) ────────────
  'a11y.spinner_label': 'Loading, please wait',
  'a11y.progress_label': 'Progress indicator',
  'a11y.error_icon': 'Error indicator',
  'a11y.success_icon': 'Success indicator',
  'a11y.warning_icon': 'Warning indicator',
  'a11y.high_contrast_mode': 'High contrast mode enabled',
  'a11y.screen_reader_mode': 'Screen reader mode enabled',

  // ─── Sandbox ───────────────────────────────────────────────────
  'sandbox.read_only': 'Read-only sandbox',
  'sandbox.workspace_write': 'Workspace-write sandbox',
  'sandbox.danger_full_access': 'DANGER: Full access (no sandbox)',
  'sandbox.violation': 'Sandbox violation: {action} not permitted in {mode} mode',

  // ─── Approval ──────────────────────────────────────────────────
  'approval.tier1_safe': 'Tier 1 (Safe) — auto-approved',
  'approval.tier2_risky': 'Tier 2 (Risky) — requires approval',
  'approval.tier3_dangerous': 'Tier 3 (Dangerous) — requires explicit approval',
  'approval.prompt': 'Approve this action? (y/N)',
};
