/**
 * Crash-recovery test (T-012).
 *
 * Verifies that the agent loop can recover from a mid-task crash (SIGKILL)
 * by resuming from the JSONL session store. The test:
 *   1. Creates a session
 *   2. Appends several messages (simulating mid-task progress)
 *   3. Does NOT gracefully close (simulating SIGKILL — no cleanup)
 *   4. Creates a NEW JsonlSessionStore instance (simulating a restart)
 *   5. Resumes the session by ID
 *   6. Verifies all messages are recovered
 *   7. Verifies the session can be branched (for diverging retries)
 *
 * This mirrors the real crash-recovery flow:
 *   - Agent is running, writing messages to <id>.jsonl (append-only)
 *   - Process is killed (OOM, SIGKILL, power loss)
 *   - User runs `goli --resume <id>` to continue
 *   - JsonlSessionStore.resume() reads the JSONL file + metadata
 *   - Agent loop re-initializes with the recovered messages
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { JsonlSessionStore } from '../../packages/memory-engine/src/session/jsonl-store.js';

import type { Message } from '@goli-cli/agent-core';

function makeMessage(role: Message['role'], content: string, idx: number): Message {
  return {
    id: `msg-${idx}-${Date.now()}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    tokens: { input: 10, output: 5, total: 15 },
  };
}

describe('T-012: crash-recovery for agent loop', () => {
  let sessionsDir: string;
  let origGoliHome: string | undefined;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'goli-t012-crash-'));
    origGoliHome = process.env['GOLI_HOME'];
    process.env['GOLI_HOME'] = sessionsDir;
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
    if (origGoliHome === undefined) {
      delete process.env['GOLI_HOME'];
    } else {
      process.env['GOLI_HOME'] = origGoliHome;
    }
  });

  it('simulates SIGKILL mid-task and recovers via resume()', () => {
    // ─── Phase 1: Start a session and write some messages ──────────
    const store1 = new JsonlSessionStore({ sessionsDir });
    const session = store1.createSession({
      prompt: 'Refactor the auth module to use JWT',
      role: 'orchestrator',
    });

    const messages: Message[] = [
      makeMessage('user', 'Refactor the auth module to use JWT', 0),
      makeMessage('assistant', 'I\'ll start by reading the current auth module...', 1),
      makeMessage('tool', 'read_file: src/auth/login.ts (45 lines)', 2),
      makeMessage('assistant', 'The login function uses session cookies. I\'ll replace with JWT...', 3),
      makeMessage('tool', 'edit_file: src/auth/login.ts (replaced session logic with JWT)', 4),
    ];

    for (const msg of messages) {
      store1.appendMessage(session.id, msg);
    }

    // Verify messages were written
    const jsonlPath = join(sessionsDir, `${session.id}.jsonl`);
    expect(existsSync(jsonlPath)).toBe(true);
    const raw = readFileSync(jsonlPath, 'utf-8');
    expect(raw.split('\n').filter((l) => l.trim()).length).toBe(5);

    // ─── Phase 2: Simulate SIGKILL ─────────────────────────────────
    // We DON'T call any cleanup. We just drop the reference to store1
    // and create a brand new instance. In a real crash, the process
    // would die and the JSONL file would be left on disk as-is.
    // (The append-only design means each message is flushed to disk
    // immediately — no buffered writes to lose.)

    // ─── Phase 3: Restart and resume ───────────────────────────────
    const store2 = new JsonlSessionStore({ sessionsDir });
    const recovered = store2.resume(session.id);

    expect(recovered).not.toBeNull();
    expect(recovered!.metadata.id).toBe(session.id);
    expect(recovered!.metadata.prompt).toBe('Refactor the auth module to use JWT');
    expect(recovered!.metadata.role).toBe('orchestrator');

    // All 5 messages should be recovered
    expect(recovered!.messages.length).toBe(5);
    expect(recovered!.messages[0]!.role).toBe('user');
    expect(recovered!.messages[0]!.content).toContain('Refactor the auth module');
    expect(recovered!.messages[4]!.role).toBe('tool');
    expect(recovered!.messages[4]!.content).toContain('edit_file');

    // The recovered messages should match the originals (round-trip)
    for (let i = 0; i < messages.length; i++) {
      expect(recovered!.messages[i]!.id).toBe(messages[i]!.id);
      expect(recovered!.messages[i]!.content).toBe(messages[i]!.content);
      expect(recovered!.messages[i]!.role).toBe(messages[i]!.role);
    }
  });

  it('can branch a crashed session to retry from a midpoint', () => {
    const store1 = new JsonlSessionStore({ sessionsDir });
    const session = store1.createSession({
      prompt: 'Fix the bug in parser.ts',
      role: 'orchestrator',
    });

    // Write 4 messages
    const messages: Message[] = [
      makeMessage('user', 'Fix the bug', 0),
      makeMessage('assistant', 'Reading the file...', 1),
      makeMessage('tool', 'read_file: parser.ts', 2),
      makeMessage('assistant', 'Found the bug on line 42', 3),
    ];
    for (const msg of messages) {
      store1.appendMessage(session.id, msg);
    }

    // Crash + restart
    const store2 = new JsonlSessionStore({ sessionsDir });

    // Branch from message index 2 (slice(0, 2) = messages 0, 1)
    const branched = store2.branch(session.id, 2);

    expect(branched.id).not.toBe(session.id); // new ID
    expect(branched.parentId).toBe(session.id); // links to original
    expect(branched.prompt).toBe('Fix the bug in parser.ts');

    // The branched session should have the first 2 messages (indices 0, 1)
    // because branch() does messages.slice(0, branchPoint)
    const recovered = store2.resume(branched.id);
    expect(recovered).not.toBeNull();
    expect(recovered!.messages.length).toBe(2); // messages 0, 1
    expect(recovered!.messages[0]!.content).toBe('Fix the bug');
    expect(recovered!.messages[1]!.content).toBe('Reading the file...');
  });

  it('handles corrupted JSONL gracefully (partial last line)', () => {
    const store1 = new JsonlSessionStore({ sessionsDir });
    const session = store1.createSession({
      prompt: 'Test corruption recovery',
      role: 'orchestrator',
    });

    // Write 3 valid messages
    for (let i = 0; i < 3; i++) {
      store1.appendMessage(session.id, makeMessage('assistant', `Message ${i}`, i));
    }

    // Corrupt the file by appending a partial JSON line (simulating a
    // crash mid-write — the last line may be incomplete)
    const { appendFileSync } = require('node:fs');
    const jsonlPath = join(sessionsDir, `${session.id}.jsonl`);
    appendFileSync(jsonlPath, '{"id":"msg-partial","role":"assistant","content":"partial write that got cut o');

    // Restart and resume — should recover the 3 valid messages and
    // skip the corrupted partial line (or include it partially)
    const store2 = new JsonlSessionStore({ sessionsDir });
    const recovered = store2.resume(session.id);

    expect(recovered).not.toBeNull();
    // At least the 3 valid messages should be recovered
    expect(recovered!.messages.length).toBeGreaterThanOrEqual(3);
    // The 3 valid messages should be intact
    expect(recovered!.messages[0]!.content).toBe('Message 0');
    expect(recovered!.messages[1]!.content).toBe('Message 1');
    expect(recovered!.messages[2]!.content).toBe('Message 2');
  });

  it('survives multiple crash-restart cycles (append-only durability)', () => {
    const store1 = new JsonlSessionStore({ sessionsDir });
    const session = store1.createSession({
      prompt: 'Multi-crash test',
      role: 'orchestrator',
    });

    // Cycle 1: write 2 messages, crash
    store1.appendMessage(session.id, makeMessage('user', 'Start', 0));
    store1.appendMessage(session.id, makeMessage('assistant', 'Beginning', 1));

    // Restart 1
    const store2 = new JsonlSessionStore({ sessionsDir });
    store2.appendMessage(session.id, makeMessage('assistant', 'Continuing', 2));

    // Restart 2
    const store3 = new JsonlSessionStore({ sessionsDir });
    store3.appendMessage(session.id, makeMessage('tool', 'did something', 3));

    // Restart 3 — final recovery
    const store4 = new JsonlSessionStore({ sessionsDir });
    const recovered = store4.resume(session.id);

    expect(recovered).not.toBeNull();
    // All 4 messages across 3 restart cycles should be present
    expect(recovered!.messages.length).toBe(4);
    expect(recovered!.messages[0]!.content).toBe('Start');
    expect(recovered!.messages[3]!.content).toBe('did something');
  });

  it('resume() returns null for non-existent session', () => {
    const store = new JsonlSessionStore({ sessionsDir });
    const recovered = store.resume('nonexistent-session-id');
    expect(recovered).toBeNull();
  });

  it('listSessions() includes crashed sessions', () => {
    const store1 = new JsonlSessionStore({ sessionsDir });
    store1.createSession({ prompt: 'Task A', role: 'orchestrator' });
    store1.createSession({ prompt: 'Task B', role: 'orchestrator' });

    // Crash + restart
    const store2 = new JsonlSessionStore({ sessionsDir });
    const sessions = store2.listSessions();
    expect(sessions.length).toBe(2);
    const prompts = sessions.map((s) => s.prompt).sort();
    expect(prompts).toEqual(['Task A', 'Task B']);
  });
});
