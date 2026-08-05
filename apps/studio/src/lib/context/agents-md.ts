/**
 * Goli Studio — AGENTS.md parser.
 *
 * Reads `AGENTS.md` (or `CLAUDE.md` / `GOLI.md` fallbacks) from the workspace
 * root and returns the raw text to inject into the agent system prompt, plus a
 * short summary for display.
 *
 * Hierarchy (vault spec): project-root AGENTS.md is authoritative; a parent
 * dir AGENTS.md may augment. For v0.1 we read only the workspace-root file.
 * A hierarchy walk is a v0.2 concern.
 *
 * The parser is tolerant: if the file is missing, it returns null (no
 * preamble). If it exists but is unreadable, it returns an error note so the
 * agent can surface it. Markdown is passed through verbatim — the model
 * handles structure.
 */
import { promises as fs } from 'node:fs';

import { resolveSafePath, toRelative, WorkspaceError } from '../storage/workspace';

/** Filenames searched, in priority order. */
const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'GOLI.md'];

/**
 *
 */
export interface AgentsMdResult {
  /** The raw markdown text to inject. null if no file was found. */
  text: string | null;
  /** The filename that was found (e.g. "AGENTS.md"). null if none. */
  filename: string | null;
  /** Absolute path of the file that was read. null if none. */
  absPath: string | null;
  /** A one-line summary for UI display. */
  summary: string;
  /** Error message if a file existed but couldn't be read. */
  error?: string;
}

/**
 * Load the project instructions file from the workspace root.
 * Safe: routes through resolveSafePath so a malicious path can't escape.
 */
export async function loadAgentsMd(workspaceDir: string): Promise<AgentsMdResult> {
  for (const name of CANDIDATES) {
    let abs: string;
    try {
      abs = await resolveSafePath(workspaceDir, name);
    } catch (e) {
      // Shouldn't happen for a plain relative path at the root, but be safe.
      return {
        text: null,
        filename: null,
        absPath: null,
        summary: 'Workspace path invalid.',
        error: (e as WorkspaceError).message,
      };
    }

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      // Not found — try the next candidate.
      continue;
    }
    if (!stat.isFile()) continue;

    let text: string;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch (e) {
      return {
        text: null,
        filename: name,
        absPath: abs,
        summary: `Could not read ${name}: ${(e as Error).message}`,
        error: (e as Error).message,
      };
    }

    // Cap the injected text so a huge AGENTS.md can't blow the context.
    const cap = 8000;
    const truncated = text.length > cap;
    const injected = truncated ? text.slice(0, cap) + '\n\n[...truncated...]' : text;

    const ruleCount = countRules(injected);
    return {
      text: injected,
      filename: name,
      absPath: abs,
      summary: `${name}: ${ruleCount} rule(s)${truncated ? ' (truncated)' : ''}`,
    };
  }

  return {
    text: null,
    filename: null,
    absPath: null,
    summary: 'No AGENTS.md found.',
  };
}

/** Rough heuristic: count lines that look like rules (bullets or numbered). */
function countRules(md: string): number {
  let n = 0;
  for (const line of md.split('\n')) {
    if (/^\s*([-*+]|\d+\.)\s+\S/.test(line)) n++;
  }
  return n;
}

/** Format the AGENTS.md text for injection into the system prompt. */
export function formatAgentsMdPreamble(result: AgentsMdResult): string {
  if (!result.text) return '';
  const header = `# Project instructions (from ${result.filename})`;
  return `${header}\n${result.text}`;
}

/**
 *
 */
export { toRelative };
