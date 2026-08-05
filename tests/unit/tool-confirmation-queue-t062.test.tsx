/**
 * Tests for the Tool Confirmation Queue + Session Allowlist (T-062).
 *
 * Covers:
 *   - enqueuePermission: first becomes active, others queue
 *   - index/total populated correctly (1-indexed)
 *   - resolveApproval advances to next queued permission
 *   - "always" approval adds to session allowlist
 *   - isAllowlisted returns true for matching (tool, argPrefix) pairs
 *   - clearAllowlist empties the allowlist (called on /clear)
 *   - clearConfirmationQueue denies pending + clears queue
 *   - PermissionDialog renders "Approve N of M" when total > 1
 *   - PermissionDialog omits queue label when total === 1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { AppStateStore } from '../../apps/cli/src/tui/state/AppStateStore.js';
import type { PendingPermission } from '../../apps/cli/src/tui/state/types.js';
import { PermissionDialog } from '../../apps/cli/src/tui/components/PermissionDialog.js';

function makePermission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    permissionId: `perm-${Math.random().toString(36).slice(2, 8)}`,
    tool: 'write_file',
    tier: 'T1',
    arg: 'src/foo.ts',
    ...overrides,
  };
}

// Reset the singleton between tests. We can't construct a new instance
// (it's a module-level singleton), so we clear all T-062 state.
function resetStore(): void {
  AppStateStore.clearConfirmationQueue();
  AppStateStore.clearAllowlist();
}

// ─── enqueuePermission ────────────────────────────────────────────────────

describe('T-062: enqueuePermission', () => {
  beforeEach(() => resetStore());

  it('first enqueued permission becomes the active pending permission', () => {
    const p = makePermission();
    AppStateStore.enqueuePermission(p);
    const active = AppStateStore.getPendingPermission();
    expect(active).not.toBeNull();
    expect(active!.permissionId).toBe(p.permissionId);
  });

  it('subsequent enqueues wait in the queue (not active)', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    expect(AppStateStore.getPendingPermission()!.permissionId).toBe('p1');
    expect(AppStateStore.getQueueLength()).toBe(1);
    expect(AppStateStore.getQueue()[0]!.permissionId).toBe('p2');
  });

  it('populates index=1 and total=N on the active permission', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    const p3 = makePermission({ permissionId: 'p3' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.enqueuePermission(p3);
    const active = AppStateStore.getPendingPermission()!;
    expect(active.index).toBe(1);
    expect(active.total).toBe(3);
  });

  it('populates index=2..N on queued permissions', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    const p3 = makePermission({ permissionId: 'p3' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.enqueuePermission(p3);
    const queue = AppStateStore.getQueue();
    expect(queue[0]!.index).toBe(2);
    expect(queue[0]!.total).toBe(3);
    expect(queue[1]!.index).toBe(3);
    expect(queue[1]!.total).toBe(3);
  });
});

// ─── resolveApproval advances the queue ───────────────────────────────────

describe('T-062: resolveApproval advances the queue', () => {
  beforeEach(() => resetStore());

  it('resolving the active permission promotes the next queued one', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.resolveApproval({ approve: true, always: false });
    const active = AppStateStore.getPendingPermission();
    expect(active).not.toBeNull();
    expect(active!.permissionId).toBe('p2');
    expect(AppStateStore.getQueueLength()).toBe(0);
  });

  it('the promoted permission gets index=1 and total=remaining', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.resolveApproval({ approve: true, always: false });
    const active = AppStateStore.getPendingPermission()!;
    expect(active.index).toBe(1);
    expect(active.total).toBe(1);
  });

  it('resolving the last permission clears the active pending', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.resolveApproval({ approve: true, always: false });
    expect(AppStateStore.getPendingPermission()).toBeNull();
  });

  it('resolving with deny also advances the queue', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.resolveApproval({ approve: false, always: false });
    expect(AppStateStore.getPendingPermission()!.permissionId).toBe('p2');
  });
});

// ─── Session allowlist ────────────────────────────────────────────────────

describe('T-062: session allowlist', () => {
  beforeEach(() => resetStore());

  it('"always" approval adds to the allowlist', () => {
    const p = makePermission({ tool: 'run_shell_command', arg: 'npm test' });
    AppStateStore.enqueuePermission(p);
    AppStateStore.resolveApproval({ approve: true, always: true });
    const allowlist = AppStateStore.getAllowlist();
    expect(allowlist).toHaveLength(1);
    expect(allowlist[0]!.tool).toBe('run_shell_command');
    expect(allowlist[0]!.argPrefix).toBe('npm test');
  });

  it('isAllowlisted returns true for matching (tool, arg) prefix', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test')).toBe(true);
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test -- --watch')).toBe(true);
  });

  it('isAllowlisted returns false for non-matching tool', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.isAllowlisted('write_file', 'npm test')).toBe(false);
  });

  it('isAllowlisted returns false for non-matching arg prefix', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm run build')).toBe(false);
  });

  it('addToAllowlist is idempotent (no duplicates)', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.getAllowlist()).toHaveLength(1);
  });

  it('clearAllowlist empties the allowlist', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('write_file', 'src/');
    AppStateStore.clearAllowlist();
    expect(AppStateStore.getAllowlist()).toHaveLength(0);
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test')).toBe(false);
  });

  it('"always" approval extracts first 3 words as the argPrefix', () => {
    const p = makePermission({
      tool: 'run_shell_command',
      arg: 'npm test -- --watch --fast',
    });
    AppStateStore.enqueuePermission(p);
    AppStateStore.resolveApproval({ approve: true, always: true });
    const allowlist = AppStateStore.getAllowlist();
    expect(allowlist[0]!.argPrefix).toBe('npm test --');
  });

  it('"always" approval on a non-shell tool uses the full arg as argPrefix', () => {
    const p = makePermission({
      tool: 'write_file',
      arg: 'src/foo.ts',
    });
    AppStateStore.enqueuePermission(p);
    AppStateStore.resolveApproval({ approve: true, always: true });
    const allowlist = AppStateStore.getAllowlist();
    expect(allowlist[0]!.argPrefix).toBe('src/foo.ts');
  });
});

// ─── clearConfirmationQueue ───────────────────────────────────────────────

describe('T-062: clearConfirmationQueue', () => {
  beforeEach(() => resetStore());

  it('clears the queue and the active pending', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    const p2 = makePermission({ permissionId: 'p2' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.clearConfirmationQueue();
    expect(AppStateStore.getPendingPermission()).toBeNull();
    expect(AppStateStore.getQueueLength()).toBe(0);
  });

  it('denies the currently active permission (calls resolver with approve=false)', () => {
    const p1 = makePermission({ permissionId: 'p1' });
    AppStateStore.enqueuePermission(p1);
    // Start waiting for approval.
    const promise = AppStateStore.waitForApproval(p1).catch(() => null);
    //waitForApproval sets pending + resolver; but enqueuePermission already set pending.
    //We need to test clearConfirmationQueue denies the pending. Reset and use waitForApproval.
    resetStore();
    const p2 = makePermission({ permissionId: 'p2' });
    const promise2 = AppStateStore.waitForApproval(p2);
    AppStateStore.clearConfirmationQueue();
    return promise2.then((decision) => {
      expect(decision.approve).toBe(false);
      expect(decision.always).toBe(false);
    });
  });
});

// ─── PermissionDialog renders queue position ──────────────────────────────

describe('T-062: PermissionDialog queue position display', () => {
  beforeEach(() => resetStore());

  it('renders "Permission Request (1 of 3)" when index=1, total=3', () => {
    const request = makePermission({ index: 1, total: 3 });
    const { lastFrame } = render(<PermissionDialog request={request} cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Permission Request');
    expect(frame).toContain('(1 of 3)');
  });

  it('renders "Permission Request (2 of 3)" when index=2, total=3', () => {
    const request = makePermission({ index: 2, total: 3 });
    const { lastFrame } = render(<PermissionDialog request={request} cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(2 of 3)');
  });

  it('omits the queue label when total === 1', () => {
    const request = makePermission({ index: 1, total: 1 });
    const { lastFrame } = render(<PermissionDialog request={request} cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Permission Request');
    expect(frame).not.toContain('(1 of 1)');
    expect(frame).not.toMatch(/\(\d+ of \d+\)/);
  });

  it('omits the queue label when index/total are undefined', () => {
    const request = makePermission({}); // no index/total
    const { lastFrame } = render(<PermissionDialog request={request} cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/\(\d+ of \d+\)/);
  });

  it('still renders tool and target info alongside the queue label', () => {
    const request = makePermission({
      tool: 'run_shell_command',
      arg: 'rm -rf /tmp/foo',
      index: 2,
      total: 5,
    });
    const { lastFrame } = render(<PermissionDialog request={request} cols={80} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('run_shell_command');
    expect(frame).toContain('rm -rf /tmp/foo');
    expect(frame).toContain('(2 of 5)');
  });
});

// ─── Integration: queue + allowlist ───────────────────────────────────────

describe('T-062: integration — queue + allowlist', () => {
  beforeEach(() => resetStore());

  it('a full queue workflow: enqueue 3, approve all with always on first', () => {
    const p1 = makePermission({ permissionId: 'p1', tool: 'run_shell_command', arg: 'npm test' });
    const p2 = makePermission({ permissionId: 'p2', tool: 'run_shell_command', arg: 'npm test' });
    const p3 = makePermission({ permissionId: 'p3', tool: 'write_file', arg: 'src/foo.ts' });
    AppStateStore.enqueuePermission(p1);
    AppStateStore.enqueuePermission(p2);
    AppStateStore.enqueuePermission(p3);

    // Approve p1 with "always" — adds (run_shell_command, "npm test") to allowlist.
    AppStateStore.resolveApproval({ approve: true, always: true });
    expect(AppStateStore.getPendingPermission()!.permissionId).toBe('p2');
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test')).toBe(true);

    // Approve p2 normally.
    AppStateStore.resolveApproval({ approve: true, always: false });
    expect(AppStateStore.getPendingPermission()!.permissionId).toBe('p3');

    // Approve p3 normally.
    AppStateStore.resolveApproval({ approve: true, always: false });
    expect(AppStateStore.getPendingPermission()).toBeNull();

    // Allowlist should have 1 entry (from p1's "always").
    expect(AppStateStore.getAllowlist()).toHaveLength(1);
  });

  it('isAllowlisted can be used to skip the dialog for allowlisted commands', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    const p = makePermission({ tool: 'run_shell_command', arg: 'npm test' });
    // Caller checks isAllowlisted BEFORE calling enqueuePermission.
    if (AppStateStore.isAllowlisted(p.tool, p.arg)) {
      // Skip the dialog — auto-approve.
      expect(true).toBe(true);
    } else {
      AppStateStore.enqueuePermission(p);
    }
    expect(AppStateStore.getPendingPermission()).toBeNull();
  });
});
