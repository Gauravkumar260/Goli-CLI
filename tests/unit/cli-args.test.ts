/**
 * Unit tests for the CLI command types and helpers.
 *
 * Phase 1 tested a hand-rolled arg parser (parseArgs). Phase 2 migrated
 * to Commander.js, so these tests now cover the global-options extraction
 * and command-context builder.
 */

import { describe, it, expect } from 'vitest';

import {
  extractGlobalOptions,
  buildCommandContext,
} from '../../packages/cli/src/commands/types.js';
import { DEFAULT_CONFIG } from '../../packages/core/src/config/schema.js';

describe('extractGlobalOptions', () => {
  it('extracts all known options', () => {
    const opts = extractGlobalOptions({
      debug: true,
      model: 'ollama/gpt-oss:120b',
      god: true,
      auto: true,
      sandbox: 'read-only',
      effort: 'max',
    });
    expect(opts.debug).toBe(true);
    expect(opts.model).toBe('ollama/gpt-oss:120b');
    expect(opts.god).toBe(true);
    expect(opts.auto).toBe(true);
    expect(opts.sandbox).toBe('read-only');
    expect(opts.effort).toBe('max');
  });

  it('handles empty options', () => {
    const opts = extractGlobalOptions({});
    expect(opts.debug).toBeUndefined();
    expect(opts.model).toBeUndefined();
    expect(opts.god).toBeUndefined();
    expect(opts.auto).toBeUndefined();
    expect(opts.sandbox).toBeUndefined();
    expect(opts.effort).toBeUndefined();
    expect(opts.localLlms).toBeUndefined();
  });

  it('extracts the localLlms flag', () => {
    const opts = extractGlobalOptions({ localLlms: true });
    expect(opts.localLlms).toBe(true);
  });
});

describe('buildCommandContext', () => {
  it('builds a context with godMode and autoMode flags', () => {
    const ctx = buildCommandContext(
      { god: true, auto: false },
      DEFAULT_CONFIG,
    );
    expect(ctx.godMode).toBe(true);
    expect(ctx.autoMode).toBe(false);
    expect(ctx.config).toBe(DEFAULT_CONFIG);
  });

  it('defaults godMode and autoMode to false', () => {
    const ctx = buildCommandContext({}, DEFAULT_CONFIG);
    expect(ctx.godMode).toBe(false);
    expect(ctx.autoMode).toBe(false);
  });

  it('preserves global options on the context', () => {
    const ctx = buildCommandContext(
      { model: 'gpt-4o', effort: 'max' },
      DEFAULT_CONFIG,
    );
    expect(ctx.globalOptions.model).toBe('gpt-4o');
    expect(ctx.globalOptions.effort).toBe('max');
  });
});
