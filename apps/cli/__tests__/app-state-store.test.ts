/**
 * Unit tests for the AppStateStore (reference design).
 */

import { describe, it, expect } from 'vitest';

import { AppStateStore } from '../src/tui/state/AppStateStore.js';

describe('AppStateStore', () => {
  it('starts with default state', () => {
    const snap = AppStateStore.getSnapshot();
    expect(snap.mode).toBe('SAFE');
    expect(snap.tier).toBe('T1');
    expect(snap.tokens).toBe(0);
    expect(snap.sessionPhase).toBe('NEW');
    expect(snap.activeAgents).toEqual(['orchestrator']);
  });

  it('toggleGodMode switches SAFE ↔ GOD', () => {
    AppStateStore.patch({ mode: 'SAFE' });
    AppStateStore.toggleGodMode();
    expect(AppStateStore.getSnapshot().mode).toBe('GOD');
    AppStateStore.toggleGodMode();
    expect(AppStateStore.getSnapshot().mode).toBe('SAFE');
  });

  it('addUsage accumulates tokens and cost (3 params)', () => {
    AppStateStore.patch({ tokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
    AppStateStore.addUsage(1000, 500, 0.05);
    AppStateStore.addUsage(2000, 800, 0.10);
    const snap = AppStateStore.getSnapshot();
    expect(snap.totalInputTokens).toBe(3000);
    expect(snap.totalOutputTokens).toBe(1300);
    expect(snap.totalCostUsd).toBeCloseTo(0.15, 4);
  });

  it("resetTokens clears tokens", () => {
    AppStateStore.patch({ tokens: 50000 });
    AppStateStore.resetTokens();
    const snap = AppStateStore.getSnapshot();
    expect(snap.tokens).toBe(0);
    
  });

  it('activateSession transitions NEW → ACTIVE', () => {
    AppStateStore.patch({ sessionPhase: 'NEW' });
    AppStateStore.activateSession();
    expect(AppStateStore.getSnapshot().sessionPhase).toBe('ACTIVE');
  });

  it('queueMessage and dequeueMessage manage the queue', () => {
    AppStateStore.patch({ queuedMessages: [] });
    AppStateStore.queueMessage('first');
    AppStateStore.queueMessage('second');
    expect(AppStateStore.getSnapshot().queuedMessages).toHaveLength(2);
    const first = AppStateStore.dequeueMessage();
    expect(first?.text).toBe('first');
    expect(AppStateStore.getSnapshot().queuedMessages).toHaveLength(1);
  });

  it('subscribe receives notifications on patch', async () => {
    let received = false;
    const unsub = AppStateStore.subscribe(() => { received = true; });
    AppStateStore.patch({ tokens: 100 });
    // Reference uses coalesced notifications via queueMicrotask
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBe(true);
    unsub();
  });

  it('pushSystemMessage calls the registered listener', () => {
    const messages: Array<{ text: string; variant: string }> = [];
    AppStateStore.setOnSystemMessage((text, variant) => {
      messages.push({ text, variant });
    });
    AppStateStore.pushSystemMessage('hello', 'info');
    AppStateStore.pushSystemMessage('warning!', 'warning');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.text).toBe('hello');
    AppStateStore.setOnSystemMessage(null);
  });
});
