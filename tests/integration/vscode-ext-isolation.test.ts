/**
 * VS Code extension isolation test (T-010).
 *
 * Verifies the architectural decision documented in
 * docs/decisions/0017-vscode-ext-isolation.md:
 *   - apps/vscode-ext IS in the root workspaces array
 *   - apps/vscode-ext/package.json is a valid standalone package
 *   - The decision doc exists
 */

import { readFileSync, existsSync, globSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const ROOT_PKG = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));
const VSCODE_PKG_PATH = resolve(REPO_ROOT, 'apps/vscode-ext/package.json');
const DECISION_DOC = resolve(REPO_ROOT, 'docs/decisions/0017-vscode-ext-isolation.md');

describe('T-010: VS Code extension isolation', () => {
  describe('workspace membership', () => {
    it('apps/vscode-ext IS matched by the root workspaces globs', () => {
      const workspaces = ROOT_PKG.workspaces ?? [];
      expect(workspaces.length).toBeGreaterThan(0);
      // Phase 0 switched the workspaces array to globs (["apps/*","packages/*"]).
      // The globs must match BOTH the vscode-ext package AND the core packages.
      const matched = (): string[] =>
        workspaces.flatMap((w: string) =>
          globSync(w, { cwd: REPO_ROOT }).map((p: string) => p.replace(/\\/g, '/')),
        );
      const names = matched();
      expect(names).toContain('apps/vscode-ext');
      // The core workspace packages should also be matched by the globs.
      expect(names).toEqual(
        expect.arrayContaining(['packages/agent-core', 'apps/cli', 'packages/evals']),
      );
    });
  });

  describe('standalone package.json', () => {
    it('apps/vscode-ext/package.json exists', () => {
      expect(existsSync(VSCODE_PKG_PATH)).toBe(true);
    });

    it('has a name field', () => {
      const pkg = JSON.parse(readFileSync(VSCODE_PKG_PATH, 'utf-8'));
      expect(pkg.name).toBeDefined();
      expect(typeof pkg.name).toBe('string');
    });

    it('has VS Code-specific fields (engines.vscode, activationEvents, or contributes)', () => {
      const pkg = JSON.parse(readFileSync(VSCODE_PKG_PATH, 'utf-8'));
      // VS Code extensions must have engines.vscode and one of activationEvents/contributes
      expect(pkg.engines?.vscode).toBeDefined();
      const hasActivation = pkg.activationEvents !== undefined;
      const hasContributes = pkg.contributes !== undefined;
      expect(hasActivation || hasContributes).toBe(true);
    });

    it('does NOT declare @goli/core in its own dependencies (resolved via root node_modules symlink)', () => {
      const pkg = JSON.parse(readFileSync(VSCODE_PKG_PATH, 'utf-8'));
      const deps = pkg.dependencies ?? {};
      // The extension resolves @goli/core via the root node_modules/@goli/core
      // symlink (hoisted by npm workspaces). It does NOT need to declare it
      // in its own dependencies. See docs/decisions/0017-vscode-ext-isolation.md.
      expect(deps['@goli/core']).toBeUndefined();
    });
  });

  describe('decision documentation', () => {
    it('docs/decisions/0017-vscode-ext-isolation.md exists', () => {
      expect(existsSync(DECISION_DOC)).toBe(true);
    });

    it('decision doc explains the rationale', () => {
      const doc = readFileSync(DECISION_DOC, 'utf-8');
      // Must mention the key rationale: vscode module not on npm
      expect(doc).toContain('not on the public npm registry');
      // Must mention the decision: keep outside workspaces
      expect(doc).toContain('outside the npm workspaces');
      // Must have an ADR-style header (allow markdown bold ** wrappers)
      // Accept either 0010 (legacy) or 0017 (current) — file was renumbered
      // to resolve a collision with 0010-defensive-json-parsing.md.
      expect(doc).toMatch(/ADR 00(?:10|17):/);
      // The doc has "**Status:** Accepted" — check for both keywords on nearby lines
      expect(doc).toMatch(/Status.*Accepted/s);
    });
  });
});
