/**
 * Headless output formatter (H19).
 *
 * Formats agent run results for headless mode (`goli -p`). Supports
 * three output formats:
 *
 * - `text` (default) — plain text response to stdout, usage to stderr
 * - `json` — structured JSON object to stdout with response, tool
 *   calls, tokens, cost, iterations, duration, stop reason
 * - `stream-json` — newline-delimited JSON events (one per AgentEvent)
 *
 * ## Why structured output?
 *
 * Claude Code's `--output-format json` is the standard for CI/CD
 * integration. Scripts can parse the JSON to extract tool calls,
 * token usage, or cost — without scraping the text output. GOLI-CLI
 * previously printed plain text only, forcing scripts to grep.
 *
 * ## JSON schema
 *
 * ```json
 * {
 *   "ok": true,
 *   "stopReason": "completed",
 *   "response": "The bug is fixed...",
 *   "toolCalls": [
 *     { "name": "read_file", "args": {...}, "result": "...", "ok": true, "durationMs": 12 }
 *   ],
 *   "tokens": { "input": 1234, "output": 567, "thinking": 89, "total": 1890 },
 *   "costUsd": 0.0023,
 *   "iterations": 3,
 *   "durationMs": 4567,
 *   "todos": [{ "content": "Fix bug", "status": "completed", "priority": "high" }]
 * }
 * ```
 *
 * @module cli/headless-output
 */

import type { AgentLoopResult } from '@goli-cli/agent-core';
import type { ToolCall, Todo } from '@goli-cli/agent-core';

/** The output format for headless mode. */
export type OutputFormat = 'text' | 'json' | 'stream-json';

/** A single tool call entry in the JSON output. */
export interface ToolCallEntry {
  /** The tool name. */
  name: string;
  /** The parsed arguments. */
  args: Record<string, unknown>;
  /** The result content (truncated to 1000 chars in JSON output). */
  result?: string;
  /** Error message (if the tool failed). */
  error?: string;
  /** Whether the tool call succeeded. */
  ok: boolean;
  /** Wall-clock duration in ms. */
  durationMs?: number;
}

/** The JSON output schema. */
export interface HeadlessJsonOutput {
  /** Whether the run succeeded. */
  ok: boolean;
  /** Why the run stopped. */
  stopReason?: string;
  /** The final assistant response. */
  response: string;
  /** The tool calls made during the run. */
  toolCalls: ToolCallEntry[];
  /** Token usage. */
  tokens: {
    input: number;
    output: number;
    thinking: number;
    total: number;
  };
  /** Total cost in USD. */
  costUsd: number;
  /** Number of iterations. */
  iterations: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** The final TODO list. */
  todos: Todo[];
  /** Error message (if `ok` is false). */
  error?: string;
}

/** Maximum length of a tool result string in JSON output (to keep output manageable). */
const MAX_TOOL_RESULT_CHARS = 1000;

/**
 * Truncate a string to `maxChars`, appending `…` if truncated.
 * @param s
 * @param maxChars
 */
function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…';
}

/**
 * Convert a `ToolCall` to a `ToolCallEntry` for JSON output.
 * @param tc
 */
function toToolCallEntry(tc: ToolCall): ToolCallEntry {
  return {
    name: tc.name,
    args: tc.argumentsParsed ?? {},
    result: tc.result ? truncate(tc.result, MAX_TOOL_RESULT_CHARS) : undefined,
    error: tc.error,
    ok: tc.status === 'completed',
    durationMs: tc.durationMs,
  };
}

/**
 * Format an `AgentLoopResult` as a JSON-serializable object.
 *
 * @param result - The agent run result.
 * @param toolCalls - The tool calls made during the run (from the conversation state).
 * @returns The JSON output object.
 */
export function formatAsJson(
  result: AgentLoopResult,
  toolCalls: ToolCall[] = [],
): HeadlessJsonOutput {
  return {
    ok: result.ok,
    stopReason: result.stopReason,
    response: result.content,
    toolCalls: toolCalls.map(toToolCallEntry),
    tokens: {
      input: 0, // AgentLoopResult doesn't break down input/output/thinking
      output: 0,
      thinking: 0,
      total: result.totalTokens,
    },
    costUsd: result.totalCostUsd,
    iterations: result.iterations,
    durationMs: result.durationMs,
    todos: result.todos,
    error: result.error,
  };
}

/**
 * Format an `AgentLoopResult` as plain text (the default headless output).
 *
 * @param result - The agent run result.
 * @returns The text to write to stdout.
 */
export function formatAsText(result: AgentLoopResult): string {
  if (!result.ok) {
    return `Error: ${result.error ?? 'agent run failed'}`;
  }
  return result.content;
}

/**
 * Format a usage summary for stderr (text mode only).
 *
 * @param result - The agent run result.
 * @returns The usage string (empty if no tokens consumed).
 */
export function formatUsageSummary(result: AgentLoopResult): string {
  if (result.totalTokens === 0 && result.totalCostUsd === 0) {
    return '';
  }
  return `Tokens: ${result.totalTokens} | Cost: $${result.totalCostUsd.toFixed(4)} | Iterations: ${result.iterations} | Duration: ${result.durationMs}ms`;
}

/**
 * Parse the `--output-format` CLI flag value.
 *
 * @param value - The raw string from the CLI.
 * @returns The parsed `OutputFormat`, or `null` if invalid.
 */
export function parseOutputFormat(value: string | undefined): OutputFormat | null {
  if (value === undefined || value === '') return 'text';
  if (value === 'text' || value === 'json' || value === 'stream-json') return value;
  return null;
}
