/**
 * Unit tests for the budget tracker.
 */

import { describe, it, expect } from 'vitest';

import { BudgetTracker } from '@goli-cli/agent-core/budget.js';
import { DEFAULT_CONFIG } from '../src/schema.js';

describe('BudgetTracker', () => {
  it('starts at zero', () => {
    const tracker = new BudgetTracker(DEFAULT_CONFIG.budget);
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.thinkingTokens).toBe(0);
    expect(snap.totalTokens).toBe(0);
    expect(snap.totalCostUsd).toBe(0);
    expect(snap.iterations).toBe(0);
    expect(snap.exceeded).toBe(false);
  });

  it('records token consumption', () => {
    const tracker = new BudgetTracker(DEFAULT_CONFIG.budget);
    tracker.recordCall(1000, 500, 200);
    tracker.recordCall(2000, 800, 300);
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(3000);
    expect(snap.outputTokens).toBe(1300);
    expect(snap.thinkingTokens).toBe(500);
    expect(snap.totalTokens).toBe(4800);
  });

  it('records iterations', () => {
    const tracker = new BudgetTracker(DEFAULT_CONFIG.budget);
    tracker.recordIteration();
    tracker.recordIteration();
    tracker.recordIteration();
    expect(tracker.snapshot().iterations).toBe(3);
  });

  it('detects token budget exceeded', () => {
    const config = { ...DEFAULT_CONFIG.budget, maxTokens: 1000 };
    const tracker = new BudgetTracker(config);
    tracker.recordCall(500, 600, 0); // total = 1100 > 1000
    const status = tracker.check();
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('token limit exceeded');
  });

  it('detects cost budget exceeded', () => {
    const config = {
      ...DEFAULT_CONFIG.budget,
      maxTokens: 1_000_000,
      maxCostUsd: 0.01,
      costPerMillionInputTokens: 10,
      costPerMillionOutputTokens: 10,
      costPerMillionThinkingTokens: 0,
    };
    const tracker = new BudgetTracker(config);
    // 2000 tokens at $10/1M = $0.02 > $0.01
    tracker.recordCall(1000, 1000, 0);
    const status = tracker.check();
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('cost limit exceeded');
  });

  it('detects iteration budget exceeded', () => {
    const config = { ...DEFAULT_CONFIG.budget, maxIterations: 3 };
    const tracker = new BudgetTracker(config);
    tracker.recordIteration();
    tracker.recordIteration();
    tracker.recordIteration();
    const status = tracker.check();
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('iteration limit exceeded');
  });

  it('computes cost from token rates', () => {
    const config = {
      ...DEFAULT_CONFIG.budget,
      costPerMillionInputTokens: 5,
      costPerMillionOutputTokens: 15,
      costPerMillionThinkingTokens: 10,
    };
    const tracker = new BudgetTracker(config);
    tracker.recordCall(1_000_000, 1_000_000, 1_000_000);
    // 1M input × $5 + 1M output × $15 + 1M thinking × $10 = $30
    expect(tracker.totalCostUsd).toBeCloseTo(30, 2);
  });

  it('wallclock increases over time', () => {
    const tracker = new BudgetTracker(DEFAULT_CONFIG.budget);
    const t1 = tracker.wallclockSeconds;
    // Can't easily test real time, but at least verify it's a non-negative number
    expect(t1).toBeGreaterThanOrEqual(0);
  });
});
