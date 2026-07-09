/**
 * Cron scheduler test (T-015).
 *
 * Verifies the cron entry CRUD operations + schedule validation +
 * shouldFire() matching logic. This is a Hermes-parity feature.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  addCronEntry,
  removeCronEntry,
  listCronEntries,
  setCronEnabled,
  markCronRun,
  validateCronExpression,
  shouldFire,
  defaultCronConfigPath,
} from '../../packages/cli/src/commands/cron.js';

describe('T-015: cron scheduler (Hermes parity)', () => {
  let configDir: string;
  let configPath: string;
  let origGoliHome: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'goli-t015-cron-'));
    configPath = join(configDir, 'cron.json');
    origGoliHome = process.env['GOLI_HOME'];
    process.env['GOLI_HOME'] = configDir;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (origGoliHome === undefined) {
      delete process.env['GOLI_HOME'];
    } else {
      process.env['GOLI_HOME'] = origGoliHome;
    }
  });

  describe('validateCronExpression', () => {
    it('accepts a valid 5-field expression', () => {
      expect(validateCronExpression('0 9 * * *').ok).toBe(true);
      expect(validateCronExpression('*/15 * * * *').ok).toBe(true);
      expect(validateCronExpression('0 0 1 1 *').ok).toBe(true);
      expect(validateCronExpression('30 14 * * 1-5').ok).toBe(true);
    });

    it('rejects expressions with wrong field count', () => {
      expect(validateCronExpression('0 9 * *').ok).toBe(false);
      expect(validateCronExpression('0 9 * * * *').ok).toBe(false);
    });

    it('rejects out-of-range values', () => {
      expect(validateCronExpression('60 9 * * *').ok).toBe(false); // minute > 59
      expect(validateCronExpression('0 24 * * *').ok).toBe(false); // hour > 23
      expect(validateCronExpression('0 9 32 * *').ok).toBe(false); // dom > 31
      expect(validateCronExpression('0 9 * 13 *').ok).toBe(false); // month > 12
    });

    it('accepts ranges and steps', () => {
      expect(validateCronExpression('0-30 9 * * *').ok).toBe(true);
      expect(validateCronExpression('*/15 * * * *').ok).toBe(true);
      expect(validateCronExpression('0,15,30,45 * * * *').ok).toBe(true);
    });
  });

  describe('addCronEntry', () => {
    it('adds a valid entry', () => {
      const result = addCronEntry('0 9 * * *', 'Daily standup', configPath);
      expect(result.ok).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry!.schedule).toBe('0 9 * * *');
      expect(result.entry!.prompt).toBe('Daily standup');
      expect(result.entry!.enabled).toBe(true);
      expect(result.entry!.lastRunAt).toBeNull();
      expect(result.entry!.id).toBeTruthy();
    });

    it('rejects invalid schedule', () => {
      const result = addCronEntry('invalid', 'test', configPath);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects empty prompt', () => {
      const result = addCronEntry('0 9 * * *', '', configPath);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('persists to the config file', () => {
      addCronEntry('0 9 * * *', 'Task A', configPath);
      addCronEntry('0 17 * * *', 'Task B', configPath);
      const entries = listCronEntries(configPath);
      expect(entries.length).toBe(2);
    });
  });

  describe('listCronEntries', () => {
    it('returns empty array when no config file', () => {
      expect(listCronEntries(configPath)).toEqual([]);
    });

    it('returns all entries', () => {
      addCronEntry('0 9 * * *', 'Task A', configPath);
      addCronEntry('0 17 * * *', 'Task B', configPath);
      const entries = listCronEntries(configPath);
      expect(entries.length).toBe(2);
      expect(entries.some((e) => e.prompt === 'Task A')).toBe(true);
      expect(entries.some((e) => e.prompt === 'Task B')).toBe(true);
    });
  });

  describe('removeCronEntry', () => {
    it('removes an entry by ID', () => {
      const result = addCronEntry('0 9 * * *', 'Task A', configPath);
      const id = result.entry!.id;
      expect(removeCronEntry(id, configPath)).toBe(true);
      expect(listCronEntries(configPath).length).toBe(0);
    });

    it('returns false for non-existent ID', () => {
      expect(removeCronEntry('nonexistent', configPath)).toBe(false);
    });
  });

  describe('setCronEnabled', () => {
    it('disables an entry', () => {
      const result = addCronEntry('0 9 * * *', 'Task A', configPath);
      const id = result.entry!.id;
      setCronEnabled(id, false, configPath);
      const entries = listCronEntries(configPath);
      expect(entries[0]!.enabled).toBe(false);
    });

    it('re-enables an entry', () => {
      const result = addCronEntry('0 9 * * *', 'Task A', configPath);
      const id = result.entry!.id;
      setCronEnabled(id, false, configPath);
      setCronEnabled(id, true, configPath);
      const entries = listCronEntries(configPath);
      expect(entries[0]!.enabled).toBe(true);
    });
  });

  describe('markCronRun', () => {
    it('updates lastRunAt', () => {
      const result = addCronEntry('0 9 * * *', 'Task A', configPath);
      const id = result.entry!.id;
      expect(result.entry!.lastRunAt).toBeNull();
      markCronRun(id, configPath);
      const entries = listCronEntries(configPath);
      expect(entries[0]!.lastRunAt).not.toBeNull();
    });
  });

  describe('shouldFire', () => {
    it('matches every-minute schedule', () => {
      expect(shouldFire('* * * * *', new Date('2026-07-05T10:30:00Z'))).toBe(true);
    });

    it('matches specific minute', () => {
      expect(shouldFire('0 * * * *', new Date('2026-07-05T10:00:00Z'))).toBe(true);
      expect(shouldFire('0 * * * *', new Date('2026-07-05T10:30:00Z'))).toBe(false);
    });

    it('matches daily at 9am', () => {
      expect(shouldFire('0 9 * * *', new Date('2026-07-05T09:00:00Z'))).toBe(true);
      expect(shouldFire('0 9 * * *', new Date('2026-07-05T10:00:00Z'))).toBe(false);
    });

    it('matches every 15 minutes', () => {
      expect(shouldFire('*/15 * * * *', new Date('2026-07-05T10:00:00Z'))).toBe(true);
      expect(shouldFire('*/15 * * * *', new Date('2026-07-05T10:15:00Z'))).toBe(true);
      expect(shouldFire('*/15 * * * *', new Date('2026-07-05T10:30:00Z'))).toBe(true);
      expect(shouldFire('*/15 * * * *', new Date('2026-07-05T10:07:00Z'))).toBe(false);
    });

    it('matches day-of-week range (Mon-Fri)', () => {
      // 2026-07-06 is a Monday
      expect(shouldFire('0 9 * * 1-5', new Date('2026-07-06T09:00:00Z'))).toBe(true);
      // 2026-07-11 is a Saturday
      expect(shouldFire('0 9 * * 1-5', new Date('2026-07-11T09:00:00Z'))).toBe(false);
    });

    it('matches Sunday (0 or 7)', () => {
      // 2026-07-05 is a Sunday
      expect(shouldFire('0 9 * * 0', new Date('2026-07-05T09:00:00Z'))).toBe(true);
      expect(shouldFire('0 9 * * 7', new Date('2026-07-05T09:00:00Z'))).toBe(true);
    });
  });

  describe('defaultCronConfigPath', () => {
    it('respects GOLI_HOME env var', () => {
      process.env['GOLI_HOME'] = configDir;
      expect(defaultCronConfigPath()).toBe(join(configDir, 'cron.json'));
    });
  });
});
