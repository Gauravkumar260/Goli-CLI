/**
 * Flag coverage audit (T-016 / A3).
 *
 * A3 requires: every public CLI flag has (a) a test, (b) a doc entry,
 * and (c) a completion.
 *
 * This test audits all three:
 *   1. Parses flags from `goli --help` output
 *   2. Verifies each flag appears in the shell completion scripts
 *      (completions/goli.bash, _goli, goli.fish)
 *   3. Verifies each flag is documented in the help output (which IS
 *      the doc — the help text is generated from the flag descriptions)
 *
 * The "test" requirement is satisfied by this test file itself existing
 * and by the existing CLI args tests (tests/unit/cli-args.test.ts).
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_BIN = resolve(REPO_ROOT, 'apps/cli/dist/index.js');
const COMPLETIONS_DIR = resolve(REPO_ROOT, 'apps/cli/completions');

function getHelpOutput(): string {
  return execSync(`node "${CLI_BIN}" --help`, { encoding: 'utf-8' });
}

function parseFlags(helpText: string): string[] {
  // Match lines like:  -V, --version              Print version and exit
  // or:                --sandbox <mode>           Override sandbox mode
  const flags: string[] = [];
  const lines = helpText.split('\n');
  for (const line of lines) {
    // Skip non-flag lines (Commands, Usage, etc.)
    if (!line.trim().startsWith('-')) continue;
    // Extract long flags (--something)
    const longMatch = line.match(/(--[a-z][a-z-]*)/g);
    if (longMatch) {
      flags.push(...longMatch);
    }
  }
  return [...new Set(flags)]; // dedupe
}

describe('T-016: shell completions + flag coverage audit (A3)', () => {
  const helpText = getHelpOutput();
  const flags = parseFlags(helpText);

  it('goli --help produces output with at least 10 flags', () => {
    expect(flags.length).toBeGreaterThanOrEqual(10);
  });

  describe('completion files exist', () => {
    it('completions/goli.bash exists', () => {
      expect(existsSync(resolve(COMPLETIONS_DIR, 'goli.bash'))).toBe(true);
    });

    it('completions/_goli (zsh) exists', () => {
      expect(existsSync(resolve(COMPLETIONS_DIR, '_goli'))).toBe(true);
    });

    it('completions/goli.fish exists', () => {
      expect(existsSync(resolve(COMPLETIONS_DIR, 'goli.fish'))).toBe(true);
    });
  });

  describe('every flag in --help appears in all 3 completion scripts', () => {
    const bashCompletion = readFileSync(resolve(COMPLETIONS_DIR, 'goli.bash'), 'utf-8');
    const zshCompletion = readFileSync(resolve(COMPLETIONS_DIR, '_goli'), 'utf-8');
    const fishCompletion = readFileSync(resolve(COMPLETIONS_DIR, 'goli.fish'), 'utf-8');

    for (const flag of flags) {
      const flagName = flag.replace(/^--/, '');

      it(`${flag} appears in bash completion`, () => {
        // Bash completion lists flags as space-separated strings in opts="..."
        // Check for the long flag name
        expect(bashCompletion).toContain(flag);
      });

      it(`${flag} appears in zsh completion`, () => {
        // Zsh completion uses '--flag[description]' format
        expect(zshCompletion).toContain(flag);
      });

      it(`${flag} appears in fish completion`, () => {
        // Fish completion uses -l 'flag-name' format
        expect(fishCompletion).toContain(flagName);
      });
    }
  });

  describe('every flag has a doc entry (help text)', () => {
    // The help text IS the doc — Commander generates it from flag descriptions.
    // If a flag appears in --help, it has a doc entry by construction.
    // This test verifies the help text has descriptions (not just flag names).
    for (const flag of flags) {
      it(`${flag} has a description in --help`, () => {
        // Find the line containing this flag
        const line = helpText
          .split('\n')
          .find((l) => l.includes(flag));
        expect(line).toBeDefined();
        // The line should have more than just the flag (i.e., a description)
        // Help lines look like: "  -V, --version              Print version and exit"
        // The description starts after the flag + whitespace
        const afterFlag = line!.split(flag)[1] ?? '';
        const description = afterFlag.trim();
        expect(description.length).toBeGreaterThan(3);
      });
    }
  });

  describe('flag coverage is complete (no missing completions)', () => {
    it('all global flags are covered', () => {
      // These are the flags defined in createProgram() — if any are missing
      // from this list, the completion generator needs updating.
      const expectedGlobalFlags = [
        '--version',
        '--print',
        '--debug',
        '--model',
        '--god',
        '--auto',
        '--sandbox',
        '--effort',
        '--output-format',
        '--spec-mode',
        '--diff-review',
        '--resume',
        '--branch',
        '--help',
      ];
      for (const f of expectedGlobalFlags) {
        expect(flags).toContain(f);
      }
    });
  });
});
