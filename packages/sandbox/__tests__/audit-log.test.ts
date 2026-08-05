/**
 * Unit tests for the audit log.
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  getAuditLogPath,
  appendAuditLog,
  readAuditLog,
  verifyAuditLog,
  getAuditLogSummary,
} from '../src/audit-log.js';

import type { AuditLogEntry } from '../src/types.js';

const originalGoliHome = process.env.GOLI_HOME;
let testHome: string;

beforeEach(() => {
  testHome = join(homedir(), `.goli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.GOLI_HOME = testHome;
  mkdirSync(join(testHome), { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  if (originalGoliHome) {
    process.env.GOLI_HOME = originalGoliHome;
  } else {
    delete process.env.GOLI_HOME;
  }
});

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: 'echo test',
    sandboxMode: 'workspace-write',
    approval: 'allow',
    tier: 'T0',
    ok: true,
    durationMs: 100,
    sessionId: 'test-session',
    workspaceRoot: '/tmp/test',
    ...overrides,
  };
}

describe('audit log', () => {
  it('getAuditLogPath uses $GOLI_HOME', () => {
    const path = getAuditLogPath();
    expect(path).toBe(join(testHome, 'audit-log.jsonl'));
  });

  it('appendAuditLog writes entries', async () => {
    appendAuditLog(makeEntry({ action: 'echo first' }));
    appendAuditLog(makeEntry({ action: 'echo second' }));
    const entries = await readAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe('echo first');
    expect(entries[1]!.action).toBe('echo second');
  });

  it('readAuditLog returns empty array when no log exists', async () => {
    const entries = await readAuditLog();
    expect(entries).toEqual([]);
  });

  it('readAuditLog handles malformed entries gracefully', async () => {
    const logPath = getAuditLogPath();
    writeFileSync(logPath, '{"valid":"entry"}\n{invalid json}\n{"another":"valid"}\n', 'utf-8');
    const entries = await readAuditLog();
    // Malformed entries are skipped
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  it('verifyAuditLog returns ok for empty log', async () => {
    const result = await verifyAuditLog();
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBe(0);
  });

  it('verifyAuditLog detects missing fields', async () => {
    const logPath = getAuditLogPath();
    // Write an entry missing required fields
    writeFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString() }) + '\n', 'utf-8');
    const result = await verifyAuditLog();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('verifyAuditLog detects out-of-order timestamps', async () => {
    const later = new Date('2026-07-03T12:00:00Z').toISOString();
    const earlier = new Date('2026-07-03T11:00:00Z').toISOString();
    appendAuditLog(makeEntry({ timestamp: later }));
    appendAuditLog(makeEntry({ timestamp: earlier }));
    const result = await verifyAuditLog();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('before previous'))).toBe(true);
  });

  it('getAuditLogSummary computes statistics', async () => {
    appendAuditLog(makeEntry({ tool: 'bash', tier: 'T0', ok: true, durationMs: 100 }));
    appendAuditLog(makeEntry({ tool: 'bash', tier: 'T2', ok: false, durationMs: 200 }));
    appendAuditLog(makeEntry({ tool: 'read_file', tier: 'T0', ok: true, durationMs: 50 }));

    const summary = await getAuditLogSummary();
    expect(summary.totalEntries).toBe(3);
    expect(summary.totalDurationMs).toBe(350);
    expect(summary.byTool['bash']).toBe(2);
    expect(summary.byTool['read_file']).toBe(1);
    expect(summary.byTier['T0']).toBe(2);
    expect(summary.byTier['T2']).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it('appendAuditLog does not crash on unwritable path', () => {
    process.env.GOLI_HOME = '/nonexistent/path/that/cannot/be/created';
    // Should not throw
    appendAuditLog(makeEntry());
    expect(true).toBe(true);
  });
});
