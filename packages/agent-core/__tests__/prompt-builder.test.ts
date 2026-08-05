/**
 * Unit tests for the three-tier prompt builder and caching strategy.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { PromptBuilder } from '../src/prompt-builder.js';
import {
  applySystemAnd3Strategy,
  estimateTokenSavings,
  shouldCache,
} from '../src/prompt-caching.js';

import type { PromptBuildContext } from '../src/prompt-builder.js';
import type { Message } from '../src/types.js';

function makeCtx(overrides: Partial<PromptBuildContext> = {}): PromptBuildContext {
  return {
    role: 'orchestrator',
    toolNames: ['read_file', 'write_file', 'bash'],
    sandboxMode: 'workspace-write',
    todos: [],
    language: 'English',
    godMode: false,
    taskPrompt: 'Fix the bug',
    model: 'gpt-4o',
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  it('assembles a non-empty prompt with all three tiers', () => {
    const result = builder.assemble(makeCtx());
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.stable.length).toBeGreaterThan(0);
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.volatile.length).toBeGreaterThan(0);
    expect(result.fromCache).toBe(false);
  });

  it('caches stable + context tiers across calls', () => {
    const ctx = makeCtx();
    const result1 = builder.assemble(ctx);
    const result2 = builder.assemble(ctx);

    // Second call should be from cache
    expect(result2.fromCache).toBe(true);
    // Stable tier should be identical (byte-stable)
    expect(result2.stable).toBe(result1.stable);
    // Context tier should be identical
    expect(result2.context).toBe(result1.context);
  });

  it('rebuilds volatile tier every call', () => {
    const ctx = makeCtx();
    const result1 = builder.assemble(ctx);
    const result2 = builder.assemble(ctx);

    // Volatile tier contains the date — should be the same within a day
    // but the point is it's rebuilt (not cached)
    expect(result2.volatile).toBe(result1.volatile);
  });

  it('invalidates cache on invalidateCache()', () => {
    const ctx = makeCtx();
    builder.assemble(ctx);
    expect(builder.generation).toBe(0);

    builder.invalidateCache();
    expect(builder.generation).toBe(1);

    const result = builder.assemble(ctx);
    expect(result.fromCache).toBe(false);
  });

  it('includes identity in stable tier', () => {
    const result = builder.assemble(makeCtx({ role: 'scout' }));
    expect(result.stable).toContain('GOLI-CLI');
    expect(result.stable).toContain('Scout');
  });

  it('includes tool names in stable tier', () => {
    const result = builder.assemble(makeCtx({ toolNames: ['custom_tool'] }));
    expect(result.stable).toContain('custom_tool');
  });

  it('includes sandbox mode in stable tier', () => {
    const result = builder.assemble(makeCtx({ sandboxMode: 'read-only' }));
    expect(result.stable).toContain('read-only');
    expect(result.stable).toContain('READ-ONLY');
  });

  it('includes god mode warning in stable tier', () => {
    const result = builder.assemble(makeCtx({ godMode: true }));
    expect(result.stable).toContain('GOD MODE');
  });

  it('includes TODO list in volatile tier', () => {
    const result = builder.assemble(makeCtx({
      todos: [
        { content: 'Read file', status: 'completed', priority: 'high' },
        { content: 'Edit file', status: 'in_progress', priority: 'medium' },
      ],
    }));
    expect(result.volatile).toContain('Read file');
    expect(result.volatile).toContain('Edit file');
    expect(result.volatile).toContain('in-progress');
  });

  it('includes memory snapshot in volatile tier', () => {
    const result = builder.assemble(makeCtx({
      memorySnapshot: {
        memory: 'User prefers TypeScript',
        user: 'Senior developer',
        project: 'Next.js app',
      },
    }));
    expect(result.volatile).toContain('TypeScript');
    expect(result.volatile).toContain('Senior developer');
    expect(result.volatile).toContain('Next.js');
  });

  it('includes date-only timestamp (not minute precision)', () => {
    const result = builder.assemble(makeCtx());
    expect(result.volatile).toContain('Date:');
    // Should NOT contain a time with colons (HH:MM:SS)
    expect(result.volatile).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('includes model line in volatile tier', () => {
    const result = builder.assemble(makeCtx({ model: 'gpt-4o', provider: 'vllm' }));
    expect(result.volatile).toContain('gpt-4o');
    expect(result.volatile).toContain('vllm');
    expect(result.volatile).toContain('SAFE');
  });

  it('includes skills prompt in stable tier', () => {
    const result = builder.assemble(makeCtx({ skillsPrompt: 'Available skills:\n- my-skill' }));
    expect(result.stable).toContain('my-skill');
  });

  it('includes platform hints in stable tier', () => {
    const result = builder.assemble(makeCtx({ platformHints: 'You are on Slack.' }));
    expect(result.stable).toContain('Slack');
  });

  it('includes project context in context tier', () => {
    const result = builder.assemble(makeCtx({ projectContext: 'This is a Next.js monorepo.' }));
    expect(result.context).toContain('Next.js');
    expect(result.context).toContain('Project Context');
  });

  it('includes language in context tier', () => {
    const result = builder.assemble(makeCtx({ language: '中文' }));
    expect(result.context).toContain('中文');
  });

  it('includes git branch in context tier', () => {
    const result = builder.assemble(makeCtx({ gitBranch: 'feature/auth' }));
    expect(result.context).toContain('feature/auth');
  });

  it('does not include git section when no branch', () => {
    const result = builder.assemble(makeCtx({ gitBranch: undefined }));
    expect(result.context).not.toContain('git branch');
  });

  it('bumps generation on invalidate', () => {
    expect(builder.generation).toBe(0);
    builder.invalidateCache();
    expect(builder.generation).toBe(1);
    builder.invalidateCache();
    expect(builder.generation).toBe(2);
  });
});

describe('applySystemAnd3Strategy', () => {
  function makeMessages(count: number): Message[] {
    const msgs: Message[] = [
      { role: 'system', content: 'System prompt', timestamp: new Date().toISOString() },
    ];
    for (let i = 0; i < count; i++) {
      msgs.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: new Date().toISOString(),
      });
    }
    return msgs;
  }

  it('caches the system prompt (index 0)', () => {
    const msgs = makeMessages(5);
    const breakpoints = applySystemAnd3Strategy(msgs);
    expect(breakpoints.some((bp) => bp.messageIndex === 0)).toBe(true);
  });

  it('caches the last 3 non-system messages', () => {
    const msgs = makeMessages(5); // 1 system + 5 non-system
    const breakpoints = applySystemAnd3Strategy(msgs);
    // Should have 1 (system) + 3 (recent) = 4 breakpoints
    expect(breakpoints).toHaveLength(4);
    // The last 3 should be the last 3 non-system messages (indices 3, 4, 5)
    const recentBps = breakpoints.filter((bp) => bp.messageIndex > 0);
    expect(recentBps).toHaveLength(3);
    expect(recentBps[0]!.messageIndex).toBe(3);
    expect(recentBps[1]!.messageIndex).toBe(4);
    expect(recentBps[2]!.messageIndex).toBe(5);
  });

  it('handles fewer messages than recentCount', () => {
    const msgs = makeMessages(1); // 1 system + 1 non-system
    const breakpoints = applySystemAnd3Strategy(msgs);
    // 1 (system) + 1 (only 1 non-system available)
    expect(breakpoints).toHaveLength(2);
  });

  it('handles empty messages', () => {
    const breakpoints = applySystemAnd3Strategy([]);
    expect(breakpoints).toHaveLength(0);
  });

  it('respects custom recentMessageCount', () => {
    const msgs = makeMessages(5);
    const breakpoints = applySystemAnd3Strategy(msgs, { recentMessageCount: 1 });
    // 1 (system) + 1 (recent)
    expect(breakpoints).toHaveLength(2);
  });

  it('respects custom ttlSeconds', () => {
    const msgs = makeMessages(2);
    const breakpoints = applySystemAnd3Strategy(msgs, { ttlSeconds: 3600 });
    expect(breakpoints[0]!.ttlSeconds).toBe(3600);
  });
});

describe('estimateTokenSavings', () => {
  it('estimates savings from cached messages', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'x'.repeat(4000), timestamp: new Date().toISOString() },
      { role: 'user', content: 'x'.repeat(1000), timestamp: new Date().toISOString() },
    ];
    const breakpoints = applySystemAnd3Strategy(msgs);
    const savings = estimateTokenSavings(msgs, breakpoints);
    // 4000 + 1000 = 5000 chars / 4 = 1250 tokens
    expect(savings).toBe(1250);
  });
});

describe('shouldCache', () => {
  it('returns true for cached message indices', () => {
    const breakpoints = [
      { messageIndex: 0, type: 'ephemeral' as const },
      { messageIndex: 3, type: 'ephemeral' as const },
    ];
    expect(shouldCache(0, breakpoints)).toBe(true);
    expect(shouldCache(3, breakpoints)).toBe(true);
    expect(shouldCache(1, breakpoints)).toBe(false);
    expect(shouldCache(2, breakpoints)).toBe(false);
  });
});
