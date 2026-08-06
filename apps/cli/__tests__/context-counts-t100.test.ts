/**
 * Tests for T-100: Real context source counts (useContextCounts hook).
 *
 * Covers:
 *   - scanCounts() returns zero counts in an empty directory
 *   - scanCounts() detects AGENTS.md
 *   - scanCounts() detects GOLI.md
 *   - scanCounts() detects CLAUDE.md
 *   - scanCounts() detects multiple memory files
 *   - scanCounts() counts MCP servers from mcp.json
 *   - scanCounts() counts skills from .goli/skills/
 *   - countMemoryFiles() counts correctly
 *   - countMcpServers() counts correctly
 *   - countSkills() counts correctly
 *   - useContextCounts() hook returns counts without crashing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scanCounts,
  countMemoryFiles,
  countMcpServers,
  countSkills,
  useContextCounts,
} from '../src/tui/hooks/useContextCounts.js';

let testDir: string;
let origCwd: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-ctx-counts-'));
  origCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(testDir, { recursive: true, force: true });
});

// ─── scanCounts() ───────────────────────────────────────────────────

describe('T-100: scanCounts() in empty directory', () => {
  it('returns zero counts when no files exist', () => {
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(0);
    expect(counts.mcpServerCount).toBe(0);
    expect(counts.skillCount).toBe(0);
  });
});

describe('T-100: scanCounts() memory file detection', () => {
  it('detects AGENTS.md', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Test');
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(1);
  });

  it('detects GOLI.md', () => {
    writeFileSync(join(testDir, 'GOLI.md'), '# Test');
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(1);
  });

  it('detects CLAUDE.md', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '# Test');
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(1);
  });

  it('detects .goli/AGENTS.md', () => {
    mkdirSync(join(testDir, '.goli'));
    writeFileSync(join(testDir, '.goli', 'AGENTS.md'), '# Test');
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(1);
  });

  it('detects multiple memory files', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Test');
    writeFileSync(join(testDir, 'GOLI.md'), '# Test');
    writeFileSync(join(testDir, 'CLAUDE.md'), '# Test');
    const counts = scanCounts();
    expect(counts.agentsMdCount).toBe(3);
  });
});


describe('T-100: scanCounts() MCP server detection', () => {
  it('counts MCP servers from .goli/mcp.json', () => {
    mkdirSync(join(testDir, '.goli'));
    writeFileSync(
      join(testDir, '.goli', 'mcp.json'),
      JSON.stringify({ mcpServers: { server1: {}, server2: {}, server3: {} } }),
    );
    const counts = scanCounts();
    expect(counts.mcpServerCount).toBe(3);
  });

  it('returns 0 when mcp.json has no servers key', () => {
    mkdirSync(join(testDir, '.goli'));
    writeFileSync(join(testDir, '.goli', 'mcp.json'), JSON.stringify({}));
    const counts = scanCounts();
    expect(counts.mcpServerCount).toBe(0);
  });
});


describe('T-100: scanCounts() skills detection', () => {
  it('counts .md files in .goli/skills/', () => {
    mkdirSync(join(testDir, '.goli', 'skills'), { recursive: true });
    writeFileSync(join(testDir, '.goli', 'skills', 'skill1.md'), '# Skill 1');
    writeFileSync(join(testDir, '.goli', 'skills', 'skill2.md'), '# Skill 2');
    writeFileSync(join(testDir, '.goli', 'skills', 'not-a-skill.txt'), 'test');
    const counts = scanCounts();
    expect(counts.skillCount).toBe(2);
  });

  it('returns 0 when .goli/skills/ does not exist', () => {
    const counts = scanCounts();
    expect(counts.skillCount).toBe(0);
  });
});


// ─── Individual count functions ─────────────────────────────────────

describe('T-100: countMemoryFiles()', () => {
  it('returns 0 for empty directory', () => {
    expect(countMemoryFiles(testDir)).toBe(0);
  });

  it('returns count of memory files', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Test');
    writeFileSync(join(testDir, 'GOLI.md'), '# Test');
    expect(countMemoryFiles(testDir)).toBe(2);
  });
});

describe('T-100: countMcpServers()', () => {
  it('returns 0 when no mcp.json exists', () => {
    expect(countMcpServers(testDir)).toBe(0);
  });
});

describe('T-100: countSkills()', () => {
  it('returns 0 when .goli/skills/ does not exist', () => {
    expect(countSkills(testDir)).toBe(0);
  });
});


// ─── useContextCounts() hook ────────────────────────────────────────

describe('T-100: useContextCounts() hook', () => {
  it('returns counts without crashing', () => {
    function TestComponent(): React.ReactElement {
      const counts = useContextCounts();
      return React.createElement('Text', null, `a=${counts.agentsMdCount}`);
    }
    const { lastFrame } = render(React.createElement(TestComponent));
    expect(lastFrame() ?? '').toContain('a=');
  });
});
