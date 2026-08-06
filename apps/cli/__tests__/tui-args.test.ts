/**
 * Unit tests for the TUI argument parser.
 */

import { describe, it, expect } from 'vitest';

import { parseArgs, toLaunchMode } from '../src/tui/args.js';

describe('parseArgs', () => {
  it('parses --help', () => {
    const result = parseArgs(['node', 'goli', '--help']);
    expect(result.showHelp).toBe(true);
  });

  it('parses --version', () => {
    const result = parseArgs(['node', 'goli', '--version']);
    expect(result.showVersion).toBe(true);
  });

  it('parses wakeup subcommand', () => {
    const result = parseArgs(['node', 'goli', 'wakeup']);
    expect(result.isWakeup).toBe(true);
  });

  it('parses --recover', () => {
    const result = parseArgs(['node', 'goli', '--recover']);
    expect(result.isRecover).toBe(true);
  });

  it('parses --clear-crash', () => {
    const result = parseArgs(['node', 'goli', '--clear-crash']);
    expect(result.isClearCrash).toBe(true);
  });

  it('parses --accessibility', () => {
    const result = parseArgs(['node', 'goli', '--accessibility']);
    expect(result.accessibility).toBe(true);
  });

  it('parses --debug', () => {
    const result = parseArgs(['node', 'goli', '--debug']);
    expect(result.debug).toBe(true);
  });

  it('captures positional prompt as initialTask', () => {
    const result = parseArgs(['node', 'goli', 'wakeup', 'refactor the auth module']);
    expect(result.initialTask).toBe('refactor the auth module');
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    expect(result.showHelp).toBe(false);
    expect(result.isWakeup).toBe(false);
    expect(result.initialTask).toBe('');
  });
});

describe('toLaunchMode', () => {
  it('returns "wakeup" when isWakeup is true', () => {
    expect(toLaunchMode({ isWakeup: true } as never)).toBe('wakeup');
  });

  it('returns "interactive" when isWakeup is false', () => {
    expect(toLaunchMode({ isWakeup: false } as never)).toBe('interactive');
  });
});
