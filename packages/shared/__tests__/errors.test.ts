/**
 * Unit tests for the error hierarchy.
 */

import { describe, it, expect } from 'vitest';

import {
  GoliError,
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  ModelError,
  ModelTimeoutError,
  ModelHTTPError,
  ToolValidationError,
  isGoliError,
  wrapUnknown,
} from '@goli-cli/shared/utils/errors.js';

// Test subclass of ConfigError for the abstract-base-class test
class TestConfigError extends ConfigError {
  override readonly code = 'TEST_CONFIG';
}

describe('GoliError hierarchy', () => {
  it('subclasses preserve their prototype chain', () => {
    const err = new ModelTimeoutError('timed out');
    expect(err).toBeInstanceOf(GoliError);
    expect(err).toBeInstanceOf(ModelTimeoutError);
    expect(err.code).toBe('MODEL_TIMEOUT');
    expect(err.category).toBe('model');
  });

  it('preserves cause chain', () => {
    const root = new Error('ECONNRESET');
    const err = new ModelError('network failure', { cause: root });
    expect(err.cause).toBe(root);
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('serializes to JSON cleanly', () => {
    const err = new ModelHTTPError('HTTP 503', 503);
    const json = err.toJSON();
    expect(json.code).toBe('MODEL_HTTP');
    expect(json.category).toBe('model');
    expect(json.message).toBe('HTTP 503');
    expect((json as { status?: number }).status).toBe(503);
  });

  it('isGoliError narrows correctly', () => {
    expect(isGoliError(new ModelError('x'))).toBe(true);
    expect(isGoliError(new Error('plain'))).toBe(false);
    expect(isGoliError('string')).toBe(false);
    expect(isGoliError(null)).toBe(false);
    expect(isGoliError(undefined)).toBe(false);
  });

  it('wrapUnknown passes through GoliError instances', () => {
    const original = new ToolValidationError('bad', 'grep');
    expect(wrapUnknown(original)).toBe(original);
  });

  it('wrapUnknown wraps plain Error', () => {
    const wrapped = wrapUnknown(new Error('boom'));
    expect(wrapped).toBeInstanceOf(GoliError);
    expect(wrapped.code).toBe('UNKNOWN');
    expect(wrapped.cause).toBeInstanceOf(Error);
  });

  it('wrapUnknown stringifies non-Error values', () => {
    expect(wrapUnknown('string error').message).toBe('string error');
    expect(wrapUnknown(42).message).toBe('42');
    expect(wrapUnknown({ x: 1 }).message).toBe('[object Object]');
  });

  it('all expected error subclasses are constructable', () => {
    expect(() => new ConfigNotFoundError('missing')).not.toThrow();
    expect(() => new ConfigValidationError('bad')).not.toThrow();
    expect(() => new TestConfigError('test')).not.toThrow();
    expect(() => new ModelError('err')).not.toThrow();
    expect(() => new ModelTimeoutError('err')).not.toThrow();
    expect(() => new ToolValidationError('err', 'grep')).not.toThrow();
  });
});
