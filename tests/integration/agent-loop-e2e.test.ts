/**
 * End-to-end agent loop test with a mock LLM provider (T-007).
 *
 * Exercises the full event flow:
 *   spawn agent -> plan -> tool call -> observe -> respond
 *
 * Uses the existing MockAgentLoop (packages/cli/src/services/MockAgentLoop.ts)
 * which yields a scripted event sequence: INIT -> PLAN -> TOOL (read_file)
 * -> GEN -> DONE. This lets us verify the agent loop's event contract
 * without a real LLM API key.
 *
 * The test verifies:
 *   1. The event sequence matches the documented ReAct loop phases
 *   2. Tool call events have the required fields (id, name, tier, status)
 *   3. Tool status transitions from 'running' to 'success'
 *   4. The final 'done' event is emitted exactly once
 *   5. getLastResult() returns token + cost totals
 *   6. Abort cancels mid-stream
 *
 * Runs in < 2s (MockAgentLoop uses sub-second sleeps).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { MockAgentLoop } from '../../packages/cli/src/services/MockAgentLoop.js';

import type { AgentEvent } from '../../packages/cli/src/services/IAgentLoop.js';

describe('T-007: end-to-end agent loop with mock provider', () => {
  let agent: MockAgentLoop;

  beforeEach(() => {
    agent = new MockAgentLoop();
  });

  it('exercises spawn -> plan -> tool -> gen -> done in < 10s', async () => {
    const startMs = Date.now();
    const events: AgentEvent[] = [];

    for await (const ev of agent.run({ prompt: 'Read src/index.ts and summarize' })) {
      events.push(ev);
    }

    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs).toBeLessThan(10_000); // A7: < 10s with mock provider

    // ─── Phase sequence ──────────────────────────────────────────────
    const phases = events.filter((e) => e.kind === 'phase').map((e) => {
      // Narrow to a phase event for TS
      if (e.kind !== 'phase') throw new Error('unreachable');
      return e.phase;
    });
    expect(phases).toEqual(['INIT', 'PLAN', 'TOOL', 'GEN', 'DONE']);
  }, 15_000); // vitest timeout (a bit longer than the A7 threshold)

  it('emits a tool call with running -> success status', async () => {
    const events: AgentEvent[] = [];
    for await (const ev of agent.run({ prompt: 'anything' })) {
      events.push(ev);
    }

    const toolEvents = events.filter((e) => e.kind === 'tool');
    expect(toolEvents.length).toBeGreaterThanOrEqual(2);

    // First tool event: status='running'
    const first = toolEvents[0]!;
    if (first.kind !== 'tool') throw new Error('unreachable');
    expect(first.tool).toBeDefined();
    expect(first.tool.name).toBe('read_file');
    expect(first.tool.tier).toBe('T0');
    expect(first.tool.status).toBe('running');
    expect(first.tool.id).toBeTruthy();
    expect(first.tool.arg).toBeTruthy();

    // Second tool event: status='success' with durationMs
    const second = toolEvents[1]!;
    if (second.kind !== 'tool') throw new Error('unreachable');
    expect(second.tool.status).toBe('success');
    expect(second.tool.durationMs).toBeGreaterThan(0);
    expect(second.tool.id).toBe(first.tool.id); // same tool call
  });

  it('emits text content during the GEN phase', async () => {
    const events: AgentEvent[] = [];
    for await (const ev of agent.run({ prompt: 'anything' })) {
      events.push(ev);
    }

    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents.length).toBeGreaterThan(0);

    // Concatenate all text events; should produce non-empty output
    const fullText = textEvents
      .map((e) => (e.kind === 'text' ? e.text : ''))
      .join('');
    expect(fullText.length).toBeGreaterThan(0);
  });

  it('emits the PLAN-phase analysis text mentioning the prompt', async () => {
    const prompt = 'Fix the lint errors in src/utils.ts';
    const events: AgentEvent[] = [];
    for await (const ev of agent.run({ prompt })) {
      events.push(ev);
    }

    // The PLAN phase emits a text event with 'Analyzing: "<prompt>..."'
    const planTexts = events.filter((e) => e.kind === 'text').map((e) => {
      if (e.kind !== 'text') throw new Error('unreachable');
      return e.text;
    });
    const combined = planTexts.join('');
    expect(combined).toContain('Analyzing:');
    // The prompt is truncated to 60 chars in the mock; just check the prefix
    expect(combined).toContain(prompt.slice(0, 20));
  });

  it('emits exactly one done event at the end', async () => {
    const events: AgentEvent[] = [];
    for await (const ev of agent.run({ prompt: 'anything' })) {
      events.push(ev);
    }

    const doneEvents = events.filter((e) => e.kind === 'done');
    expect(doneEvents.length).toBe(1);
    expect(events[events.length - 1]!.kind).toBe('done');
  });

  it('returns token + cost totals via getLastResult() after completion', async () => {
    // Drain the agent
     
    for await (const _ev of agent.run({ prompt: 'anything' })) {
      // discard
    }

    const result = agent.getLastResult();
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBeGreaterThan(0);
    expect(result!.outputTokens).toBeGreaterThan(0);
    expect(typeof result!.costUsd).toBe('number');
  });

  it('abort() cancels mid-stream', async () => {
    const events: AgentEvent[] = [];
    // Schedule abort after 100ms (during the PLAN phase, before TOOL completes)
    setTimeout(() => agent.abort(), 100);

    for await (const ev of agent.run({ prompt: 'long-running task' })) {
      events.push(ev);
    }

    // After abort, the agent should emit a 'done' event and stop.
    const doneEvents = events.filter((e) => e.kind === 'done');
    expect(doneEvents.length).toBe(1);

    // The agent should NOT have completed the full sequence — it should
    // have stopped somewhere before DONE.
    const phases = events.filter((e) => e.kind === 'phase').map((e) => {
      if (e.kind !== 'phase') throw new Error('unreachable');
      return e.phase;
    });
    // Phases seen before abort: at least INIT, possibly PLAN.
    expect(phases).toContain('INIT');
    // Should NOT reach DONE (abort fires at 100ms, well before the ~1.1s DONE)
    expect(phases).not.toContain('DONE');
  });

  it('handles empty prompt gracefully', async () => {
    const events: AgentEvent[] = [];
    for await (const ev of agent.run({ prompt: '' })) {
      events.push(ev);
    }

    // The mock slices prompt to 60 chars; empty prompt yields 'Analyzing: "..."'
    const planTexts = events.filter((e) => e.kind === 'text').map((e) => {
      if (e.kind !== 'text') throw new Error('unreachable');
      return e.text;
    });
    expect(planTexts.some((t) => t.includes('Analyzing:'))).toBe(true);

    // Should still complete the full phase sequence
    const phases = events.filter((e) => e.kind === 'phase').map((e) => {
      if (e.kind !== 'phase') throw new Error('unreachable');
      return e.phase;
    });
    expect(phases).toEqual(['INIT', 'PLAN', 'TOOL', 'GEN', 'DONE']);
  });
});
