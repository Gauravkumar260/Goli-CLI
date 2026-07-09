/**
 * services/MockAgentLoop.ts — Canned-response agent for offline UI dev.
 *
 * Yields a scripted sequence of events with realistic timing, so the
 * TUI can be developed and tested without a real GLM-5.2 API key.
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

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    this.aborted = false;

    yield { kind: 'phase', phase: 'INIT' };
    await sleep(200);
    if (this.aborted) { yield { kind: 'done' }; return; }

    yield { kind: 'phase', phase: 'PLAN' };
    yield { kind: 'text', text: `Analyzing: "${input.prompt.slice(0, 60)}..."\n` };
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
    if (input.prompt.toLowerCase().includes('edit') || input.prompt.toLowerCase().includes('diff')) {
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
      await sleep(200);
      yield {
        kind: 'tool',
        tool: {
          id: editId, name: 'edit_file', tier: 'T1', arg: 'src/index.ts',
          status: 'success', durationMs: 500, meta: '+1 -1',
        },
      };
      if (this.aborted) { yield { kind: 'done' }; return; }
    }

    yield { kind: 'phase', phase: 'GEN' };
    const demo = DEMOS[Math.floor(Math.random() * DEMOS.length)] ?? DEMOS[0]!;
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

  abort(): void { this.aborted = true; }
  approve(_id: string, _always: boolean): void {}
  deny(_id: string): void {}
  getLastResult() { return this.lastResult; }
}
