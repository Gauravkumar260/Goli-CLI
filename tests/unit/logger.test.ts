/**
 * Unit tests for the logger.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createLogger, type Logger } from '../../packages/shared/src/utils/logger.js';

describe('createLogger', () => {
  let logs: string[];
  let fakeStream: { write: (s: string) => boolean };

  beforeEach(() => {
    logs = [];
    fakeStream = {
      write: (s: string) => {
        logs.push(s);
        return true;
      },
    };
  });

  it('emits at info level by default', () => {
    const log: Logger = createLogger({
      level: 'info',
      format: 'json',
      stream: fakeStream as never,
    });
    log.info('hello');
    log.debug('hidden');
    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0]!);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
  });

  it('respects level filtering', () => {
    const log: Logger = createLogger({
      level: 'warn',
      format: 'json',
      stream: fakeStream as never,
    });
    log.info('skipped');
    log.warn('kept');
    log.error('kept');
    expect(logs.length).toBe(2);
  });

  it('merges context fields', () => {
    const log: Logger = createLogger({
      level: 'debug',
      format: 'json',
      stream: fakeStream as never,
      defaultContext: { module: 'test' },
    });
    log.debug('msg', { sessionId: 's1' });
    const entry = JSON.parse(logs[0]!);
    expect(entry.module).toBe('test');
    expect(entry.sessionId).toBe('s1');
    expect(entry.msg).toBe('msg');
  });

  it('child loggers inherit and scope context', () => {
    const parent: Logger = createLogger({
      level: 'debug',
      format: 'json',
      stream: fakeStream as never,
      defaultContext: { module: 'parent' },
    });
    const child = parent.child({ sessionId: 's1' });
    child.info('child msg', { extra: 1 });
    const entry = JSON.parse(logs[0]!);
    expect(entry.module).toBe('parent');
    expect(entry.sessionId).toBe('s1');
    expect(entry.extra).toBe(1);
  });

  it('pretty format includes level and message', () => {
    const log: Logger = createLogger({
      level: 'info',
      format: 'pretty',
      stream: fakeStream as never,
    });
    log.info('hello world');
    expect(logs[0]).toContain('INFO');
    expect(logs[0]).toContain('hello world');
  });

  it('setLevel changes filtering at runtime', () => {
    const log: Logger = createLogger({
      level: 'error',
      format: 'json',
      stream: fakeStream as never,
    });
    log.info('skipped');
    log.setLevel('info');
    log.info('kept');
    expect(logs.length).toBe(1);
  });
});
