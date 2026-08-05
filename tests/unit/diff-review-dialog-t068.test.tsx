/**
 * Tests for T-068: DiffReviewDialog wired into the permission flow.
 *
 * Covers:
 *   - PermissionDialog shows "(v)iew diff" hint when diffEntry is present
 *   - PermissionDialog shows "(v)iew" hint when diffEntry is absent
 *   - DiffReviewDialog renders diff lines from old/new content
 *   - DiffReviewDialog shows file path and tool name
 *   - DiffReviewDialog shows accept/reject/accept-all/reject-all hints
 *   - MockAgentLoop emits a diffEntry for edit_file prompts
 *   - MockAgentLoop does NOT emit permission for non-edit prompts
 *   - computeDiff produces correct +/- lines
 *   - PendingPermission type carries diffEntry through the flow
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { AppStateStore } from '../../apps/cli/src/tui/state/AppStateStore.js';
import type { PendingPermission } from '../../apps/cli/src/tui/state/types.js';
import { PermissionDialog } from '../../apps/cli/src/tui/components/PermissionDialog.js';
import { DiffReviewDialog, computeDiff } from '../../apps/cli/src/tui/components/DiffReviewDialog.js';
import { MockAgentLoop } from '../../apps/cli/src/services/MockAgentLoop.js';

function makePermission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    permissionId: `perm-${Math.random().toString(36).slice(2, 8)}`,
    tool: 'edit_file',
    tier: 'T1',
    arg: 'src/foo.ts',
    ...overrides,
  };
}

function makeDiffPermission(): PendingPermission {
  return makePermission({
    tool: 'edit_file',
    diffEntry: {
      filePath: 'src/foo.ts',
      tool: 'edit_file',
      oldContent: 'const x = 1;\n',
      newContent: 'const x = 2;\n',
    },
  });
}

function resetStore(): void {
  AppStateStore.clearConfirmationQueue();
  AppStateStore.clearAllowlist();
}

// ─── PermissionDialog hint text ──────────────────────────────────────

describe('T-068: PermissionDialog diff hint', () => {
  beforeEach(() => resetStore());

  it('shows "(v)iew diff" when diffEntry is present', () => {
    const perm = makeDiffPermission();
    const { lastFrame } = render(
      <PermissionDialog request={perm} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('iew diff');
  });

  it('shows "(v)iew" (no "diff") when diffEntry is absent', () => {
    const perm = makePermission({ diffEntry: undefined });
    const { lastFrame } = render(
      <PermissionDialog request={perm} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(')iew');
    expect(frame).not.toContain('iew diff');
  });

  it('accepts onViewDiff prop without crashing', () => {
    const perm = makeDiffPermission();
    const { lastFrame } = render(
      <PermissionDialog request={perm} cols={80} onViewDiff={() => {}} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Permission Request');
  });
});


// ─── DiffReviewDialog rendering ──────────────────────────────────────

describe('T-068: DiffReviewDialog renders from PendingPermission data', () => {
  it('renders diff lines computed from old/new content', () => {
    const oldContent = 'const x = 1;\n';
    const newContent = 'const x = 2;\n';
    const diffLines = computeDiff(oldContent, newContent);
    const entries = [{
      filePath: 'src/foo.ts',
      tool: 'edit_file',
      oldContent,
      newContent,
      diffLines,
    }];
    const { lastFrame } = render(
      <DiffReviewDialog
        entries={entries}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Diff Review');
    expect(frame).toContain('src/foo.ts');
    expect(frame).toContain('-const x = 1;');
    expect(frame).toContain('+const x = 2;');
  });

  it('shows accept/reject/accept-all/reject-all hints', () => {
    const entries = [{
      filePath: 'src/foo.ts',
      tool: 'edit_file',
      oldContent: 'a\n',
      newContent: 'b\n',
      diffLines: computeDiff('a\n', 'b\n'),
    }];
    const { lastFrame } = render(
      <DiffReviewDialog
        entries={entries}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(a)ccept');
    expect(frame).toContain('(r)eject');
    expect(frame).toContain('(A)ccept all');
    expect(frame).toContain('(R)eject all');
  });

  it('shows entry index when multiple entries', () => {
    const entries = [
      { filePath: 'src/a.ts', tool: 'edit_file', oldContent: 'a\n', newContent: 'b\n', diffLines: computeDiff('a\n', 'b\n') },
      { filePath: 'src/b.ts', tool: 'edit_file', oldContent: 'c\n', newContent: 'd\n', diffLines: computeDiff('c\n', 'd\n') },
    ];
    const { lastFrame } = render(
      <DiffReviewDialog
        entries={entries}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1/2');
  });

  it('shows "All diffs reviewed" when entries array is empty', () => {
    const { lastFrame } = render(
      <DiffReviewDialog
        entries={[]}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('All diffs reviewed');
  });
});


// ─── computeDiff correctness ─────────────────────────────────────────

describe('T-068: computeDiff', () => {
  it('produces - and + lines for a simple edit', () => {
    const diff = computeDiff('old line\n', 'new line\n');
    expect(diff.some((l) => l.startsWith('-old line'))).toBe(true);
    expect(diff.some((l) => l.startsWith('+new line'))).toBe(true);
  });

  it('produces only + lines for a new file (empty old content)', () => {
    const diff = computeDiff('', 'new content\n');
    expect(diff.some((l) => l === '+new content')).toBe(true);
    expect(diff.every((l) => !l.startsWith('-'))).toBe(true);
  });

  it('includes context lines around the change', () => {
    const old = 'line1\nline2\nline3\nline4\nline5\n';
    const next = 'line1\nline2\nCHANGED\nline4\nline5\n';
    const diff = computeDiff(old, next);
    // Should have context before and after
    expect(diff.some((l) => l === ' line2')).toBe(true);
    expect(diff.some((l) => l === ' line4')).toBe(true);
  });
});


// ─── MockAgentLoop emits diffEntry ───────────────────────────────────

describe('T-068: MockAgentLoop emits diffEntry for edit prompts', () => {
  it('yields a permission event with diffEntry when prompt contains "edit"', async () => {
    const loop = new MockAgentLoop();
    const events: any[] = [];
    for await (const ev of loop.run({ prompt: 'please edit the file', messageId: 'm1', godMode: false })) {
      events.push(ev);
      if (ev.kind === 'permission') break;
    }
    const permEvent = events.find((e) => e.kind === 'permission');
    expect(permEvent).toBeDefined();
    expect(permEvent.request.tool).toBe('edit_file');
    expect(permEvent.request.diffEntry).toBeDefined();
    expect(permEvent.request.diffEntry.filePath).toBe('src/index.ts');
    expect(permEvent.request.diffEntry.oldContent).toContain('hello');
    expect(permEvent.request.diffEntry.newContent).toContain('hello, world!');
  });

  it('yields a permission event with diffEntry when prompt contains "diff"', async () => {
    const loop = new MockAgentLoop();
    const events: any[] = [];
    for await (const ev of loop.run({ prompt: 'show me a diff', messageId: 'm1', godMode: false })) {
      events.push(ev);
      if (ev.kind === 'permission') break;
    }
    const permEvent = events.find((e) => e.kind === 'permission');
    expect(permEvent).toBeDefined();
    expect(permEvent.request.diffEntry).toBeDefined();
  });

  it('does NOT yield a permission event for non-edit prompts', async () => {
    const loop = new MockAgentLoop();
    const events: any[] = [];
    for await (const ev of loop.run({ prompt: 'what is 2+2', messageId: 'm1', godMode: false })) {
      events.push(ev);
    }
    const permEvent = events.find((e) => e.kind === 'permission');
    expect(permEvent).toBeUndefined();
  });
});
