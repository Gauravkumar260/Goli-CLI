/**
 * TOML config loader for GOLI-CLI.
 *
 * Phase 1 ships with a minimal hand-rolled TOML subset parser sufficient
 * for the simple `[section] key = "value"` / `key = 123` / `key = ["a","b"]`
 * shapes used by `config/default.toml`. Phase 2 will replace this with
 * the canonical `@iarna/toml` library (MIT-licensed; SBOM-clean).
 *
 * ## Layering
 *
 * Config is loaded in this order (later layers override earlier):
 *   1. Built-in defaults from `DEFAULT_CONFIG` (in schema.ts).
 *   2. `config/default.toml` (committed to the repo).
 *   3. `$GOLI_HOME/config.toml` or `~/.goli-cli/config.toml` (per-user).
 *   4. `GOLI_*` environment variables (highest precedence).
 *
 * @module config/loader
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ConfigValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

import { AppConfigSchema, DEFAULT_CONFIG, type AppConfig } from './schema.js';

/**
 * Load and merge configuration from all sources.
 *
 * @param opts - Optional overrides for testing.
 * @param opts.configPath
 * @param opts.skipUserConfig
 * @returns The validated {@link AppConfig}.
 * @throws {ConfigNotFoundError} if a specified config file is missing.
 * @throws {ConfigValidationError} if the merged config fails zod validation.
 */
export function loadConfig(
  opts: { configPath?: string; skipUserConfig?: boolean } = {},
): AppConfig {
  const layers: Array<Record<string, unknown>> = [];

  // Layer 1: defaults
  layers.push(DEFAULT_CONFIG as unknown as Record<string, unknown>);

  // Layer 2: repo-level config/default.toml
  const repoConfigPath = opts.configPath ?? join(process.cwd(), 'config', 'default.toml');
  if (existsSync(repoConfigPath)) {
    layers.push(parseToml(readFileSync(repoConfigPath, 'utf-8'), repoConfigPath));
  }

  // Layer 3: user-level config ($GOLI_HOME/config.toml or ~/.goli-cli/config.toml)
  if (!opts.skipUserConfig) {
    const userHome = process.env.GOLI_HOME ?? join(homedir(), '.goli-cli');
    const userConfigPath = join(userHome, 'config.toml');
    if (existsSync(userConfigPath)) {
      layers.push(parseToml(readFileSync(userConfigPath, 'utf-8'), userConfigPath));
    }
  }

  // Layer 4: environment variables (GOLI_MODEL_MODEL_ID, GOLI_BUDGET_MAX_COST_USD, etc.)
  const envLayer = loadEnvLayer();
  if (Object.keys(envLayer).length > 0) {
    layers.push(envLayer);
  }

  // Merge deeply (one level of nesting: [section] key = value)
  const merged = deepMerge(layers);

  // Validate
  const result = AppConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigValidationError(`Invalid config: ${result.error.message}`, {
      cause: result.error,
    });
  }

  logger.debug('Config loaded', {
    layers: layers.length,
    model: result.data.model.modelId,
    sandboxMode: result.data.sandbox.mode,
  });

  return result.data;
}

/**
 * Parse a minimal TOML subset: sections, key-value pairs, strings,
 * integers, floats, booleans, and arrays of strings.
 *
 * This is NOT a full TOML parser — it handles only the shapes we use in
 * `config/default.toml`. Phase 2 will replace it with `@iarna/toml`.
 * @param text
 * @param sourcePath
 */
function parseToml(text: string, sourcePath: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line || line.startsWith('#')) continue;

    // Section header: [section] or [section.subsection]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionPath = (sectionMatch[1] ?? '').trim().split('.');
      currentSection = result;
      for (const part of sectionPath) {
        const existing = currentSection[part];
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          currentSection = existing as Record<string, unknown>;
        } else {
          const next: Record<string, unknown> = {};
          currentSection[part] = next;
          currentSection = next;
        }
      }
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (!kvMatch || !kvMatch[1] || !kvMatch[2]) {
      throw new ConfigValidationError(`Invalid TOML at ${sourcePath}:${i + 1}: ${line}`);
    }
    const [, key, rawValue] = kvMatch;
    if (!key || !rawValue) {
      throw new ConfigValidationError(`Invalid TOML at ${sourcePath}:${i + 1}: ${line}`);
    }
    currentSection[key] = parseTomlValue(rawValue, sourcePath, i + 1);
  }

  return result;
}

function parseTomlValue(raw: string, sourcePath: string, line: number): unknown {
  const trimmed = raw.trim();
  // String (double-quoted). Handle escape sequences minimally.
  // The previous implementation used `slice(1, -1)` which:
  //   - returned '' for a single '"' (starts and ends with same char)
  //   - didn't handle escape sequences (`\"`, `\\`)
  //   - didn't handle single-quoted (literal) strings
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, (_m, ch: string) => {
      switch (ch) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case '"': return '"';
        case '\\': return '\\';
        default: return ch; // unknown escape: keep the char
      }
    });
  }
  // Single-quoted (literal) string — TOML literal strings.
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // Array of strings (single-line). Multiline arrays are handled by the
  // TOML parser's line-continuation logic (not implemented — the current
  // parser is line-oriented). For robustness, we use a simple state machine
  // that respects quotes inside the array so commas inside quoted strings
  // don't split incorrectly.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    // Split on commas, respecting quotes.
    const elements: string[] = [];
    let current = '';
    let inQuotes: '"' | "'" | null = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (inQuotes) {
        current += ch;
        if (ch === inQuotes && inner[i - 1] !== '\\') {
          inQuotes = null;
        }
      } else if (ch === '"' || ch === "'") {
        inQuotes = ch;
        current += ch;
      } else if (ch === ',') {
        elements.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) elements.push(current.trim());
    return elements.map((s) => {
      const t = s.trim();
      if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        return t.slice(1, -1).replace(/\\(.)/g, (_m, ch: string) => ch === 'n' ? '\n' : ch === 't' ? '\t' : ch);
      }
      if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
        return t.slice(1, -1);
      }
      // Non-string array element (number, boolean) — parse it.
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
      if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t);
      throw new ConfigValidationError(`Invalid array element at ${sourcePath}:${line}: ${t}`);
    });
  }
  // Integer (with optional underscore separator: 1_000, hex: 0x1F, octal: 0o17, binary: 0b1010)
  if (/^-?\d[\d_]*$/.test(trimmed)) return Number.parseInt(trimmed.replace(/_/g, ''), 10);
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return Number.parseInt(trimmed, 16);
  if (/^0o[0-7]+$/.test(trimmed)) return Number.parseInt(trimmed.slice(2), 8);
  if (/^0b[01]+$/.test(trimmed)) return Number.parseInt(trimmed.slice(2), 2);
  // Float (with optional exponent: 1e10, 1.5e-3)
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(trimmed)) return Number.parseFloat(trimmed);
  if (/^-?\d+[eE][+-]?\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  // Special floats
  if (trimmed === 'inf' || trimmed === '+inf') return Infinity;
  if (trimmed === '-inf') return -Infinity;
  if (trimmed === 'nan' || trimmed === '+nan' || trimmed === '-nan') return NaN;
  // Fallback: treat as string (covers URLs, etc. that aren't quoted)
  return trimmed;
}

/**
 * Load the env-var layer. Maps `GOLI_<SECTION>_<KEY>` to
 * `{ section: { key: parsedValue } }`.
 *
 * Example: `GOLI_MODEL_API_KEY=xxx` → `{ model: { apiKey: 'xxx' } }`
 */
function loadEnvLayer(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith('GOLI_') || envValue === undefined) continue;
    const rest = envKey.slice(5); // strip GOLI_
    const parts = rest.toLowerCase().split('_');
    if (parts.length < 2) continue;
    const [section, ...keyParts] = parts;
    if (!section) continue;
    // Convert SNAKE_CASE env keys to camelCase config keys
    // e.g. API_KEY → apiKey, MAX_COST_USD → maxCostUsd
    const key = keyParts
      .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
    const sectionObj = (result[section] ?? {}) as Record<string, unknown>;
    sectionObj[key] = parseEnvValue(envValue);
    result[section] = sectionObj;
  }
  return result;
}

function parseEnvValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

/**
 * Deep-merge an array of objects (one level of nesting).
 * @param layers
 */
function deepMerge(layers: Array<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        result[key] &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge([
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        ]);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
