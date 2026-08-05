/**
 * services/MockAgentLoop.ts — Canned-response agent for offline UI dev.
 *
 * Yields a scripted sequence of events with realistic timing, so the
 * TUI can be developed and tested without a real API key.
 *
 * P2-29 fix: `approve()` and `deny()` were previously no-ops. The mock
 * would yield a `permission` event (for edit_file in the edit/diff demo
 * branch) and then immediately proceed to the success tool event,
 * ignoring the user's choice. This made the DiffReviewDialog and
 * PermissionDialog render in mock mode but pressing y/n did nothing —
 * misleading for UI testing.
 *
 * We now maintain a `pendingApproval` promise that the `run()` generator
 * `await`s after yielding a `permission` event. `approve()` / `deny()`
 * resolve that promise so the generator can proceed (or abort, if the
 * user denied). This mirrors the real CliAgentLoop's behaviour.
 */

import { randomUUID } from 'node:crypto';

import { DEMOS } from '../tui/theme/agents.js';

import type { IAgentLoop, AgentEvent, AgentRunInput } from './IAgentLoop.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 *
 */
export class MockAgentLoop implements IAgentLoop {
  private aborted = false;
  private lastResult: { inputTokens: number; outputTokens: number; costUsd: number } | null = null;
  // P2-29 fix: pending approval resolver. Set when the mock yields a
  // `permission` event; resolved by approve() / deny().
  private pendingApprovalResolve: ((approved: boolean) => void) | null = null;

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    this.aborted = false;

    yield { kind: 'phase', phase: 'INIT' };
    await sleep(200);
    if (this.aborted) { yield { kind: 'done' }; return; }

    yield { kind: 'phase', phase: 'PLAN' };
    // P2-29 fix: only append `...` if the prompt was actually truncated.
    const promptHead = input.prompt.length > 60
      ? `${input.prompt.slice(0, 60)}...`
      : input.prompt;
    yield { kind: 'text', text: `Analyzing: "${promptHead}"\n` };
    await sleep(400);
    if (this.aborted) { yield { kind: 'done' }; return; }

    yield { kind: 'phase', phase: 'TOOL' };
    const toolId = randomUUID();
    yield {
      kind: 'tool',
      tool: {
        id: toolId, name: 'read_file', tier: 'T0', arg: 'src/index.ts',
        status: 'running',
      },
    };
    await sleep(500);
    yield {
      kind: 'tool',
      tool: {
        id: toolId, name: 'read_file', tier: 'T0', arg: 'src/index.ts',
        status: 'success', durationMs: 500, meta: '12 lines',
      },
    };
    if (this.aborted) { yield { kind: 'done' }; return; }

    // T-068: Demo an edit_file permission with a diff payload so the
    // DiffReviewDialog can be exercised in offline / --demo mode.
    // P2-29 fix: cache the lowercased prompt so we don't call toLowerCase twice.
    const promptLower = input.prompt.toLowerCase();
    if (promptLower.includes('edit') || promptLower.includes('diff')) {
      yield { kind: 'phase', phase: 'TOOL' };
      const editId = randomUUID();
      yield {
        kind: 'tool',
        tool: {
          id: editId, name: 'edit_file', tier: 'T1', arg: 'src/index.ts',
          status: 'running',
        },
      };
      await sleep(300);
      yield {
        kind: 'permission',
        request: {
          tool: 'edit_file',
          tier: 'T1',
          arg: 'src/index.ts',
          diffEntry: {
            filePath: 'src/index.ts',
            tool: 'edit_file',
            oldContent: 'const greeting = "hello";\nconsole.log(greeting);\n',
            newContent: 'const greeting = "hello, world!";\nconsole.log(greeting);\nconsole.log("done");\n',
          },
        },
      };
      // P2-29 fix: WAIT for the user's approve/deny decision before
      // proceeding. Previously the mock charged ahead unconditionally.
      const approved = await this.waitForApproval();
      if (this.aborted) { yield { kind: 'done' }; return; }
      if (approved) {
        await sleep(200);
        yield {
          kind: 'tool',
          tool: {
            id: editId, name: 'edit_file', tier: 'T1', arg: 'src/index.ts',
            status: 'success', durationMs: 500, meta: '+1 -1',
          },
        };
      } else {
        // User denied — emit a denied tool result.
        await sleep(100);
        yield {
          kind: 'tool',
          tool: {
            id: editId, name: 'edit_file', tier: 'T1', arg: 'src/index.ts',
            status: 'denied', durationMs: 100,
          },
        };
        // Skip the GEN phase — the user cancelled the edit.
        this.lastResult = { inputTokens: 800, outputTokens: 50, costUsd: 0 };
        yield { kind: 'phase', phase: 'DONE' };
        yield { kind: 'done' };
        return;
      }
      if (this.aborted) { yield { kind: 'done' }; return; }
    }

    yield { kind: 'phase', phase: 'GEN' };
    // P2-29 fix: remove the dead `?? DEMOS[0]!` — Math.floor(random * length)
    // is always a valid index when DEMOS is non-empty.
    const demo = DEMOS.length > 0
      ? DEMOS[Math.floor(Math.random() * DEMOS.length)]!
      : 'Demo mode ready.';
    const words = demo.split(' ');
    for (const word of words) {
      if (this.aborted) break;
      yield { kind: 'text', text: word + ' ' };
      await sleep(30);
    }
    if (this.aborted) { yield { kind: 'done' }; return; }

    this.lastResult = { inputTokens: 1500, outputTokens: 200, costUsd: 0 };
    yield { kind: 'phase', phase: 'DONE' };
    yield { kind: 'done' };
  }

  /**
   * P2-29 fix: Wait for the user to approve or deny the pending permission.
   * Returns true if approved, false if denied (or if abort fires while
   * waiting — treated as deny).
   */
  private waitForApproval(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovalResolve = resolve;
    });
  }

  abort(): void {
    this.aborted = true;
    // P2-29 fix: resolve any pending approval as deny so the generator
    // isn't stuck waiting forever after abort.
    if (this.pendingApprovalResolve) {
      const r = this.pendingApprovalResolve;
      this.pendingApprovalResolve = null;
      r(false);
    }
  }
  approve(_id: string, _always: boolean): void {
    // P2-29 fix: resolve the pending approval as approved.
    if (this.pendingApprovalResolve) {
      const r = this.pendingApprovalResolve;
      this.pendingApprovalResolve = null;
      r(true);
    }
  }
  deny(_id: string): void {
    // P2-29 fix: resolve the pending approval as denied.
    if (this.pendingApprovalResolve) {
      const r = this.pendingApprovalResolve;
      this.pendingApprovalResolve = null;
      r(false);
    }
  }
  getLastResult() { return this.lastResult; }
}
