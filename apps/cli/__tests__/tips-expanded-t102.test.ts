/**
 * Tests for T-102: Expanded tips library (35 → 115+ tips).
 *
 * Covers:
 *   - TIPS array has at least 100 entries
 *   - All 4 categories have at least 20 tips each
 *   - No duplicate tip texts
 *   - All tips have text length > 10
 *   - Vim-specific tips exist in shortcut category
 *   - New command tips (/tips, /memory, /model, /mcp, /plan, /build)
 *   - New feature tips (MCP, sandbox, policy, cron, screen-reader)
 *   - New productivity tips (/compact, @files, !shell, GOLI_DEFAULT_MODEL)
 */

import { describe, it, expect } from 'vitest';

import {
  TIPS,
  getTipsByCategory,
  getTipCount,
} from '../src/tui/lib/tips.js';

describe('T-102: expanded tips library', () => {
  it('has at least 100 tips', () => {
    expect(getTipCount()).toBeGreaterThanOrEqual(100);
  });

  it('shortcut category has at least 20 tips', () => {
    expect(getTipsByCategory('shortcut').length).toBeGreaterThanOrEqual(20);
  });

  it('command category has at least 20 tips', () => {
    expect(getTipsByCategory('command').length).toBeGreaterThanOrEqual(20);
  });

  it('feature category has at least 20 tips', () => {
    expect(getTipsByCategory('feature').length).toBeGreaterThanOrEqual(20);
  });

  it('productivity category has at least 20 tips', () => {
    expect(getTipsByCategory('productivity').length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicate tip texts', () => {
    const texts = TIPS.map((t) => t.text);
    const unique = new Set(texts);
    expect(unique.size).toBe(texts.length);
  });

  it('all tips have text length > 10', () => {
    for (const tip of TIPS) {
      expect(tip.text.length).toBeGreaterThan(10);
    }
  });

  it('includes vim-specific shortcut tips', () => {
    const shortcuts = getTipsByCategory('shortcut');
    const vimTips = shortcuts.filter((t) => t.text.toLowerCase().includes('vim'));
    expect(vimTips.length).toBeGreaterThanOrEqual(5);
  });

  it('includes new command tips (/tips, /memory, /model, /mcp)', () => {
    const commands = getTipsByCategory('command');
    const texts = commands.map((t) => t.text);
    expect(texts.some((t) => t.includes('/tips'))).toBe(true);
    expect(texts.some((t) => t.includes('/memory'))).toBe(true);
    expect(texts.some((t) => t.includes('/model'))).toBe(true);
    expect(texts.some((t) => t.includes('/mcp'))).toBe(true);
  });

  it('includes new feature tips (MCP, sandbox, policy, cron)', () => {
    const features = getTipsByCategory('feature');
    const texts = features.map((t) => t.text);
    expect(texts.some((t) => t.includes('MCP'))).toBe(true);
    expect(texts.some((t) => t.includes('Sandbox'))).toBe(true);
    expect(texts.some((t) => t.includes('Policy'))).toBe(true);
    expect(texts.some((t) => t.includes('Cron'))).toBe(true);
  });

  it('includes screen-reader and accessibility feature tips', () => {
    const features = getTipsByCategory('feature');
    const texts = features.map((t) => t.text);
    expect(texts.some((t) => t.includes('Screen-reader'))).toBe(true);
    expect(texts.some((t) => t.includes('NO_COLOR'))).toBe(true);
    expect(texts.some((t) => t.includes('High-contrast'))).toBe(true);
    expect(texts.some((t) => t.includes('Colorblind'))).toBe(true);
  });

  it('includes new productivity tips (/compact, @files, !shell)', () => {
    const productivity = getTipsByCategory('productivity');
    const texts = productivity.map((t) => t.text);
    expect(texts.some((t) => t.includes('/compact'))).toBe(true);
    expect(texts.some((t) => t.includes('@src'))).toBe(true);
    expect(texts.some((t) => t.includes('!npm'))).toBe(true);
  });

  it('includes GOLI_DEFAULT_MODEL and GOLI_SANDBOX env var tips', () => {
    const productivity = getTipsByCategory('productivity');
    const texts = productivity.map((t) => t.text);
    expect(texts.some((t) => t.includes('GOLI_DEFAULT_MODEL'))).toBe(true);
    expect(texts.some((t) => t.includes('GOLI_SANDBOX'))).toBe(true);
  });
});
