/**
 * Docs expansion test (T-011).
 *
 * Verifies that the 3 new doc files exist and have the required content:
 *   - docs/architecture.md — module map + 11-agent pipeline
 *   - docs/getting-started.md — 5-minute tutorial
 *   - docs/agents.md — per-agent reference
 *
 * Also verifies README links to all 3 docs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('T-011: docs expansion', () => {
  describe('docs/architecture.md', () => {
    const doc = resolve(REPO_ROOT, 'docs/architecture.md');

    it('exists', () => {
      expect(existsSync(doc)).toBe(true);
    });

    it('has a module map section', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('Module Map');
      expect(src).toContain('@goli/core');
      expect(src).toContain('@goli/cli');
    });

    it('has the 11-agent pipeline', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('11-Agent Swarm');
      // At least 5 agent names
      const agents = ['Scout', 'Architect', 'Implementer', 'Reviewer', 'Documenter'];
      for (const a of agents) {
        expect(src).toContain(a);
      }
    });

    it('documents the safety gates (tier system)', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('T0');
      expect(src).toContain('T1');
      expect(src).toContain('T2');
      expect(src).toContain('T3');
    });
  });

  describe('docs/getting-started.md', () => {
    const doc = resolve(REPO_ROOT, 'docs/getting-started.md');

    it('exists', () => {
      expect(existsSync(doc)).toBe(true);
    });

    it('has prerequisites', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('Prerequisites');
      expect(src).toContain('Node.js');
    });

    it('has install steps', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('npm install');
      expect(src).toContain('npm run build');
    });

    it('has a first-task example', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('-p');
      expect(src).toMatch(/first.*(task|command)/i);
    });

    it('mentions MCP extensions', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('MCP');
    });
  });

  describe('docs/agents.md', () => {
    const doc = resolve(REPO_ROOT, 'docs/agents.md');

    it('exists', () => {
      expect(existsSync(doc)).toBe(true);
    });

    it('documents all 11 agents', () => {
      const src = readFileSync(doc, 'utf-8');
      const agents = [
        'Scout',
        'Researcher',
        'Architect',
        'Planner',
        'Implementer',
        'Debugger',
        'QA/Tester',
        'Security Auditor',
        'Reviewer',
        'Orchestrator',
        'Documenter',
      ];
      for (const a of agents) {
        expect(src).toContain(a);
      }
    });

    it('has a budget allocation table', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('Budget');
      expect(src).toContain('Token');
    });

    it('documents parallel execution', () => {
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('Parallel');
      expect(src).toContain('spawn_subagent');
    });
  });

  describe('README links to all 3 docs', () => {
    const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf-8');

    it('README links to docs/architecture.md', () => {
      expect(readme).toContain('docs/architecture.md');
    });

    it('README links to docs/getting-started.md', () => {
      expect(readme).toContain('docs/getting-started.md');
    });

    it('README links to docs/agents.md', () => {
      expect(readme).toContain('docs/agents.md');
    });

    it('README links to docs/coverage-report.md', () => {
      expect(readme).toContain('docs/coverage-report.md');
    });
  });
});
