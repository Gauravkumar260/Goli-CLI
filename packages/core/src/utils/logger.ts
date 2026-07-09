/**
 * Structured logger for GOLI-CLI.
 *
 * Phase 1 ships a lightweight console-based logger. Phase 12 (Module 6)
 * will swap the underlying sink for an OpenTelemetry-compatible exporter
 * (Langfuse self-hosted), but the public API here is stable across the
 * swap.
 *
 * ## Why not pino / winston?
 *
 * - pino: heavy dependency; we don't need its performance for our log
 *   volume in Phase 1.
 * - winston: too many transports; we want one (stdout JSON in prod,
 *   pretty in dev).
 *
 * We will revisit in Phase 12 when we wire OTel + Langfuse. Until then,
 * this logger is intentionally minimal but produces structured JSON
 * output suitable for ingestion by any log pipeline.
 *
 * ## Levels
 *
 * - `error`: a failure that breaks the current operation; user-visible.
 * - `warn`: a recoverable issue; surfaced in TUI status bar.
 * - `info`: lifecycle events (session start, tool calls, gate passes).
 * - `debug`: detailed diagnostic flow (only emitted when `GOLI_DEBUG=1`).
 * - `trace`: per-token streaming data; very noisy; opt-in only.
 *
 * @module utils/logger
 */

import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A minimal writable stream interface (avoids tight coupling to fs.WriteStream). */
export interface LogStream {
  write(chunk: string): boolean;
}

/** Log severity levels (ordered). */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Numeric ordering for level filtering. */
const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

/** Context fields attached to every log line in the current scope. */
export interface LogContext {
  /** Session ID (set on agent startup; persists for the session). */
  sessionId?: string;
  /** Module emitting the log (e.g. `'agent'`, `'sandbox'`, `'tools.grep'`). */
  module?: string;
  /** Optional trace / span ID (OTel, Phase 12). */
  traceId?: string;
  spanId?: string;
  /** Free-form structured fields. */
  [key: string]: unknown;
}

/** The public logger interface. Stable across Phase 12 OTel swap. */
export interface Logger {
  trace(msg: string, context?: LogContext): void;
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  /** Create a child logger with a fixed context scope. */
  child(scope: LogContext): Logger;
  /** Change the minimum level at runtime (e.g. for `--debug` flag). */
  setLevel(level: LogLevel): void;
  /** Get the current minimum level (child loggers return their own or inherit from parent). */
  getLevel?(): LogLevel;
  /** Flush any buffered output. No-op for sync writers. */
  flush(): void;
  /** Close any open file descriptors (lifecycle stream). Safe to call multiple times. */
  close?(): void;
}

/** Configuration for the default logger. */
export interface LoggerOptions {
  /** Minimum level to emit. Default: `'info'`. */
  level?: LogLevel;
  /** Output format. Default: `'pretty'` in TTY, `'json'` otherwise. */
  format?: 'pretty' | 'json';
  /** Override the destination stream. Default: `process.stdout`. */
  stream?: LogStream;
  /** Default context to attach to every log line. */
  defaultContext?: LogContext;
  /** Optional second sink for the on-disk lifecycle log (TUI `parentLog`). */
  lifecycleLogPath?: string;
}

/**
 * The singleton logger instance. Imported across the codebase as
 * `import { logger } from '#utils/logger'`.
 *
 * Configure via {@link configureLogger} at process startup (in
 * `src/cli/main.ts`) before any other module loads.
 */
export let logger: Logger = createLogger({ level: 'info' });

/**
 * Replace the global logger with a new configuration. Called once at
 * process startup.
 * @param opts
 */
export function configureLogger(opts: LoggerOptions): void {
  logger = createLogger(opts);
}

/**
 * Factory for a logger instance. Exposed for tests that want an isolated
 * logger (not the global singleton).
 * @param opts
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level: LogLevel = opts.level ?? 'info';
  const format: 'pretty' | 'json' = opts.format ?? (process.stdout.isTTY ? 'pretty' : 'json');
  const stream: LogStream = opts.stream ?? process.stdout;
  const defaultContext: LogContext = opts.defaultContext ?? {};
  let lifecycleStream: LogStream | null = null;
  if (opts.lifecycleLogPath) {
    try {
      mkdirSync(dirname(opts.lifecycleLogPath), { recursive: true });
      lifecycleStream = createWriteStream(opts.lifecycleLogPath, { flags: 'a' });
    } catch {
      // Lifecycle logging is best-effort; never crash on it
    }
  }

  function emit(level: LogLevel, msg: string, context: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
    const merged = { ...defaultContext, ...context, level, msg, ts: new Date().toISOString() };
    const line = format === 'json' ? JSON.stringify(merged) : formatPretty(merged);
    stream.write(line + '\n');
    if (lifecycleStream) {
      // Lifecycle log is always JSON for machine parsing (TUI `parentLog`)
      lifecycleStream.write(`[goli] ${merged.ts} ${level.toUpperCase()} ${msg}\n`);
    }
  }

  let currentLevel: LogLevel = level;
  // Track lifecycle stream so flush() can drain it and close() can free
  // the file descriptor. The previous implementation never closed the
  // stream, leaking a file descriptor per `createLogger` call with a
  // `lifecycleLogPath` (exhausting FDs in tests that create many loggers).
  let _lifecycleStream = lifecycleStream;

  return {
    trace: (msg, ctx = {}) => emit('trace', msg, ctx),
    debug: (msg, ctx = {}) => emit('debug', msg, ctx),
    info: (msg, ctx = {}) => emit('info', msg, ctx),
    warn: (msg, ctx = {}) => emit('warn', msg, ctx),
    error: (msg, ctx = {}) => emit('error', msg, ctx),
    child(scope: LogContext): Logger {
      return createChildLogger(this, scope);
    },
    setLevel(newLevel: LogLevel): void {
      currentLevel = newLevel;
    },
    getLevel(): LogLevel {
      return currentLevel;
    },
    flush(): void {
      // Drain the lifecycle stream if it has buffered writes.
      if (_lifecycleStream && typeof _lifecycleStream.write === 'function') {
        _lifecycleStream.write('');
      }
    },
    close(): void {
      // Close the lifecycle stream to free the file descriptor.
      const stream = _lifecycleStream as unknown as { end?: () => void } | null;
      if (stream && typeof stream.end === 'function') {
        stream.end();
        _lifecycleStream = null;
      }
    },
  };
}

function createChildLogger(parent: Logger, scope: LogContext): Logger {
  // Child loggers track their OWN level (defaulting to the parent's at
  // creation time). The previous implementation delegated `setLevel` to
  // the parent, which mutated the parent's level for ALL siblings —
  // `childLogger.setLevel('debug')` would enable debug for the entire
  // parent tree, defeating the purpose of scoped logging.
  let childLevel: LogLevel | null = null; // null = inherit from parent
  return {
    trace: (msg, ctx = {}) => {
      if (childLevel !== null && LEVEL_ORDER[childLevel] > LEVEL_ORDER['trace']) return;
      parent.trace(msg, { ...scope, ...ctx });
    },
    debug: (msg, ctx = {}) => {
      if (childLevel !== null && LEVEL_ORDER[childLevel] > LEVEL_ORDER['debug']) return;
      parent.debug(msg, { ...scope, ...ctx });
    },
    info: (msg, ctx = {}) => {
      if (childLevel !== null && LEVEL_ORDER[childLevel] > LEVEL_ORDER['info']) return;
      parent.info(msg, { ...scope, ...ctx });
    },
    warn: (msg, ctx = {}) => {
      if (childLevel !== null && LEVEL_ORDER[childLevel] > LEVEL_ORDER['warn']) return;
      parent.warn(msg, { ...scope, ...ctx });
    },
    error: (msg, ctx = {}) => {
      if (childLevel !== null && LEVEL_ORDER[childLevel] > LEVEL_ORDER['error']) return;
      parent.error(msg, { ...scope, ...ctx });
    },
    child(deeperScope: LogContext) {
      return createChildLogger(this, deeperScope);
    },
    setLevel(level: LogLevel) {
      // Set THIS child's level, not the parent's.
      childLevel = level;
    },
    getLevel(): LogLevel {
      return childLevel ?? (parent.getLevel?.() ?? 'info');
    },
    flush() {
      parent.flush();
    },
    close() {
      parent.close?.();
    },
  };
}

function formatPretty(entry: Record<string, unknown>): string {
  const { ts, level, msg, ...rest } = entry;
  const levelTag = (level as string).toUpperCase().padEnd(5);
  const time = new Date(ts as string).toLocaleTimeString('en-US', { hour12: false });
  const restStr = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
  return `${time} ${levelTag} ${msg}${restStr}`;
}

/**
 * Resolve the default lifecycle log path: `$GOLI_HOME/logs/goli.log`
 * or `~/.goli-cli/logs/goli.log`. Used by `src/cli/main.ts` to set up
 * the parentLog sink for TUI crash recovery (Phase 3).
 */
export function defaultLifecycleLogPath(): string {
  const home = process.env.GOLI_HOME ?? join(homedir(), '.goli-cli');
  return join(home, 'logs', 'goli.log');
}
