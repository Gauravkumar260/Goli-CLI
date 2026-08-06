/**
 * Tests for T-096: Token-cost breakdown panel + /cost command.
 *
 * Covers:
 *   - CostBreakdownPanel renders token counts
 *   - CostBreakdownPanel renders total cost
 *   - CostBreakdownPanel renders turn count + average
 *   - CostBreakdownPanel renders cost rate
 *   - formatTokens() formats correctly (K, M)
 *   - formatCost() formats correctly (different precisions)
 *   - formatRate() formats correctly
 *   - /cost command is registered
 *   - /cost has /usage and /tokens aliases
 *   - /cost is isSafeConcurrent
 *   - /cost outputs token/cost breakdown
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import {
  CostBreakdownPanel,
  formatTokens,
  formatCost,
  formatRate,
} from '../src/tui/components/CostBreakdownPanel.js';
import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

// ─── CostBreakdownPanel rendering ───────────────────────────────────

describe('T-096: CostBreakdownPanel rendering', () => {
  it('renders token counts', () => {
    const { lastFrame } = render(
      <CostBreakdownPanel
        inputTokens={10000}
        outputTokens={2300}
        totalCostUsd={0.0234}
        turnCount={5}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Tokens:');
    expect(frame).toContain('12.3K');
    expect(frame).toContain('in: 10.0K');
    expect(frame).toContain('out: 2.3K');
  });

  it('renders total cost', () => {
    const { lastFrame } = render(
      <CostBreakdownPanel
        inputTokens={1000}
        outputTokens={500}
        totalCostUsd={0.0234}
        turnCount={3}
        cols={80}
      />,
    );
    // $0.0234 < $1 → formatted with 3 decimal places as $0.023
    expect(lastFrame() ?? '').toContain('$0.023');
  });

  it('renders turn count + average', () => {
    const { lastFrame } = render(
      <CostBreakdownPanel
        inputTokens={1000}
        outputTokens={500}
        totalCostUsd={0.05}
        turnCount={5}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Turns:');
    expect(frame).toContain('5');
    expect(frame).toContain('avg');
  });

  it('renders cost rate', () => {
    const { lastFrame } = render(
      <CostBreakdownPanel
        inputTokens={10000}
        outputTokens={0}
        totalCostUsd={0.02}
        turnCount={1}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Rate:');
    expect(frame).toContain('/1K');
  });

  it('handles zero tokens gracefully', () => {
    const { lastFrame } = render(
      <CostBreakdownPanel
        inputTokens={0}
        outputTokens={0}
        totalCostUsd={0}
        turnCount={0}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Tokens:');
    expect(frame).toContain('0');
  });
});


// ─── formatTokens / formatCost / formatRate ─────────────────────────

describe('T-096: formatTokens()', () => {
  it('formats numbers < 1000 as-is', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(12345)).toBe('12.3K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('T-096: formatCost()', () => {
  it('formats costs < $0.01 with 4 decimal places', () => {
    expect(formatCost(0.001)).toBe('$0.0010');
    expect(formatCost(0.0001)).toBe('$0.0001');
  });

  it('formats costs < $1 with 3 decimal places', () => {
    expect(formatCost(0.0234)).toBe('$0.023');
    expect(formatCost(0.5)).toBe('$0.500');
  });

  it('formats costs >= $1 with 2 decimal places', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(10)).toBe('$10.00');
  });
});

describe('T-096: formatRate()', () => {
  it('formats cost per 1K tokens', () => {
    expect(formatRate(0.02, 10000)).toContain('/1K');
  });

  it('returns $0.00/1K for zero tokens', () => {
    expect(formatRate(0, 0)).toBe('$0.00/1K');
  });
});


// ─── /cost command ──────────────────────────────────────────────────

describe('T-096: /cost command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'cost');
    expect(cmd).toBeDefined();
  });

  it('has /usage as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'cost');
    expect(cmd?.altNames).toContain('usage');
  });

  it('has /tokens as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'cost');
    expect(cmd?.altNames).toContain('tokens');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'cost');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('outputs token/cost breakdown', () => {
    AppStateStore.addUsage(10000, 2000, 0.0234);
    AppStateStore.bumpTurn();

    const cmd = globalCommands.resolve('cost');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Cost Breakdown');
    expect(msg).toContain('Tokens:');
    expect(msg).toContain('Cost:');
    expect(msg).toContain('Turns:');
    expect(msg).toContain('Rate:');
    pushSpy.mockRestore();
  });
});
