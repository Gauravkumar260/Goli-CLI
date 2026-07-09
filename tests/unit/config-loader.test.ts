/**
 * Unit tests for the config loader and schema.
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig } from '../../packages/core/src/config/loader.js';
import { AppConfigSchema, DEFAULT_CONFIG } from '../../packages/core/src/config/schema.js';
import { ConfigValidationError } from '../../packages/core/src/utils/errors.js';

describe('AppConfigSchema', () => {
  it('parses an empty config (all defaults)', () => {
    const config = AppConfigSchema.parse({});
    expect(config.model.modelId).toBe('glm-5.2');
    expect(config.model.defaultEffort).toBe('high');
    expect(config.budget.maxTokens).toBe(800_000);
    expect(config.sandbox.mode).toBe('workspace-write');
  });

  it('rejects an invalid baseUrl', () => {
    const result = AppConfigSchema.safeParse({
      model: { baseUrl: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid sandbox mode', () => {
    const result = AppConfigSchema.safeParse({
      sandbox: { mode: 'god-mode' },
    });
    expect(result.success).toBe(false);
  });

  it('DEFAULT_CONFIG has all expected sections', () => {
    expect(DEFAULT_CONFIG.model).toBeDefined();
    expect(DEFAULT_CONFIG.budget).toBeDefined();
    expect(DEFAULT_CONFIG.retry).toBeDefined();
    expect(DEFAULT_CONFIG.stall).toBeDefined();
    expect(DEFAULT_CONFIG.sandbox).toBeDefined();
    expect(DEFAULT_CONFIG.logging).toBeDefined();
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `goli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads defaults when no config file exists', () => {
    const config = loadConfig({
      configPath: join(tmpDir, 'nonexistent.toml'),
      skipUserConfig: true,
    });
    expect(config.model.modelId).toBe('glm-5.2');
    expect(config.budget.maxTokens).toBe(800_000);
  });

  it('loads a TOML config file with section overrides', () => {
    const configPath = join(tmpDir, 'custom.toml');
    writeFileSync(
      configPath,
      [
        '[model]',
        'modelId = "glm-5.2-custom"',
        'defaultEffort = "max"',
        '',
        '[budget]',
        'maxCostUsd = 10.0',
      ].join('\n'),
    );
    const config = loadConfig({ configPath, skipUserConfig: true });
    expect(config.model.modelId).toBe('glm-5.2-custom');
    expect(config.model.defaultEffort).toBe('max');
    expect(config.budget.maxCostUsd).toBe(10.0);
    // Untouched values stay at defaults
    expect(config.budget.maxTokens).toBe(800_000);
  });

  it('parses arrays of strings (networkAllowlist)', () => {
    const configPath = join(tmpDir, 'allowlist.toml');
    writeFileSync(
      configPath,
      ['[sandbox]', 'networkAllowlist = ["example.com:443", "api.example.com:443"]'].join('\n'),
    );
    const config = loadConfig({ configPath, skipUserConfig: true });
    expect(config.sandbox.networkAllowlist).toEqual(['example.com:443', 'api.example.com:443']);
  });

  it('throws ConfigValidationError on invalid TOML', () => {
    const configPath = join(tmpDir, 'bad.toml');
    writeFileSync(configPath, 'this is not valid toml at all');
    expect(() => loadConfig({ configPath, skipUserConfig: true })).toThrow(ConfigValidationError);
  });

  it('env vars override TOML', () => {
    process.env.GOLI_MODEL_API_KEY = 'env-secret-key';
    process.env.GOLI_BUDGET_MAX_COST_USD = '99.0';
    try {
      const config = loadConfig({ skipUserConfig: true });
      expect(config.model.apiKey).toBe('env-secret-key');
      expect(config.budget.maxCostUsd).toBe(99.0);
    } finally {
      delete process.env.GOLI_MODEL_API_KEY;
      delete process.env.GOLI_BUDGET_MAX_COST_USD;
    }
  });
});
