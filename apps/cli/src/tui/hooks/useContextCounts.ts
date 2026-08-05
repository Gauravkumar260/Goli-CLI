/**
 * hooks/useContextCounts.ts — Real context source counts (T-100).
 *
 * The ContextSummaryDisplay was called with hardcoded agentsMdCount=1.
 * This hook scans the filesystem for real counts of:
 *   - Memory files (AGENTS.md, GOLI.md, CLAUDE.md, .cursor/rules)
 *   - MCP servers (from .goli/mcp.json or ~/.goli/mcp.json)
 *   - Skills (.goli/skills/*.md)
 *
 * The scan runs on mount and re-runs every 30 seconds (to pick up
 * files created mid-session). Returns a stable object to avoid
 * unnecessary re-renders.
 *
 * @module hooks/useContextCounts
 */
import { useState, useEffect } from 'react';
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Context source counts. */
export interface ContextCounts {
  /** Number of memory files found (AGENTS.md, GOLI.md, CLAUDE.md, .cursor/rules). */
  agentsMdCount: number;
  /** Number of MCP servers configured. */
  mcpServerCount: number;
  /** Number of skill files in .goli/skills/. */
  skillCount: number;
}

/** Empty counts (used as initial state). */
const EMPTY_COUNTS: ContextCounts = {
  agentsMdCount: 0,
  mcpServerCount: 0,
  skillCount: 0,
};

/** Memory file candidates (relative to cwd). */
const MEMORY_CANDIDATES = [
  'AGENTS.md',
  '.goli/AGENTS.md',
  'GOLI.md',
  '.goli/GOLI.md',
  'CLAUDE.md',
  '.cursor/rules',
];

/** MCP config candidates (relative to cwd + home). */
function getMcpCandidates(cwd: string): string[] {
  return [
    join(cwd, '.goli', 'mcp.json'),
    join(cwd, '.goli-cli', 'mcp.json'),
    join(homedir(), '.goli', 'mcp.json'),
    join(homedir(), '.goli-cli', 'mcp.json'),
  ];
}

/**
 * Count memory files in the given directory.
 */
function countMemoryFiles(cwd: string): number {
  let count = 0;
  for (const candidate of MEMORY_CANDIDATES) {
    const p = join(cwd, candidate);
    if (existsSync(p)) {
      try {
        const stat = statSync(p);
        if (stat.isFile() && stat.size > 0) count++;
        else if (stat.isDirectory()) count++;
      } catch {
        // Ignore stat errors.
      }
    }
  }
  return count;
}

/**
 * Count MCP servers from config files.
 */
function countMcpServers(cwd: string): number {
  let total = 0;
  for (const candidate of getMcpCandidates(cwd)) {
    if (existsSync(candidate)) {
      try {
        const content = JSON.parse(readFileSync(candidate, 'utf-8'));
        const servers = content.mcpServers ?? content.servers ?? {};
        total += Object.keys(servers).length;
      } catch {
        // Ignore parse errors.
      }
    }
  }
  return total;
}

/**
 * Count skill files in .goli/skills/.
 */
function countSkills(cwd: string): number {
  const skillsDir = join(cwd, '.goli', 'skills');
  if (!existsSync(skillsDir)) return 0;
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/**
 * Scan for real context source counts.
 */
function scanCounts(): ContextCounts {
  const cwd = process.cwd();
  return {
    agentsMdCount: countMemoryFiles(cwd),
    mcpServerCount: countMcpServers(cwd),
    skillCount: countSkills(cwd),
  };
}

/** Re-scan interval (30 seconds). */
const RESCAN_INTERVAL_MS = 30_000;

/**
 * Hook that returns real context source counts.
 * Re-scans every 30 seconds to pick up files created mid-session.
 */
export function useContextCounts(): ContextCounts {
  const [counts, setCounts] = useState<ContextCounts>(EMPTY_COUNTS);

  useEffect(() => {
    // Initial scan.
    setCounts(scanCounts());

    // Re-scan periodically.
    const interval = setInterval(() => {
      setCounts(scanCounts());
    }, RESCAN_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return counts;
}

/** Exported for tests. */
export { scanCounts, countMemoryFiles, countMcpServers, countSkills };
