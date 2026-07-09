/**
 * lib/memoryMonitor.ts — Heap-pressure watchdog (opt-in).
 *
 * Ported from hermes-agent/lib/memoryMonitor.ts and reduced to fit goli's
 * single-process architecture (no Python gateway subprocess, no forked Ink
 * cache to evict). Behaviour is preserved: V8 heap is sampled on a fixed
 * interval; when it crosses the 'high' or 'critical' threshold, a heap
 * snapshot + a one-line diagnostics file are written to
 * '~/.goli-cli/heapdumps/', a breadcrumb is appended to the existing
 * parentLog, and the caller's onHigh/onCritical callback fires.
 *
 * What this catches (no design change):
 *   - The silent-OOM regime tracked in hermes issue #34095 — a render-tree
 *     blowup that takes Node down well below the visible exit threshold
 *     and shows up only as a bare stdin EOF to the user.
 *   - The sub-threshold abnormal-growth case: heap climbing by at least
 *     150 MB per 10s tick while still under the high-water mark. Fires
 *     onWarn once and re-arms after the heap falls back below the floor.
 *
 * Activation (no UI change):
 *   GOLI_TUI_HEAPMON=1 enables the monitor on startup.
 *   Default is OFF — production launches never trigger the watchdog, and
 *   the timer doesn't even start unless explicitly opted in.
 */
import { appendFileSync, createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { getHeapSnapshot, getHeapStatistics, type HeapSnapshotOptions } from 'node:v8';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const CEILING_FALLBACK_GB = 4;
const HIGH_RATIO_DEFAULT = 0.70;
const CRITICAL_RATIO_DEFAULT = 0.88;
const FLOOR_HIGH_BYTES = 1 * GB;
const FLOOR_CRITICAL_BYTES = 2 * GB;
const FLOOR_HIGH_MINUS_CRIT_BUFFER = 256 * MB;
const WARN_GROWTH_STEP = 150 * MB;
const WARN_BYTES_DEFAULT = 600 * MB;
const COOLDOWN_MS_DEFAULT = 600000;
const INTERVAL_MS_DEFAULT = 10000;
const HEAPDUMP_KEEP = 3;
const LOG_DIR_NAME = 'logs';
const LOG_FILE_NAME = 'tui.log';
const HEAPDUMP_DIR_NAME = 'heapdumps';

/**
 *
 */
export type MemoryLevel = 'critical' | 'high' | 'normal';

/**
 *
 */
export interface MemorySnapshot {
  heapUsed: number;
  level: MemoryLevel;
  rss: number;
}

/**
 *
 */
export interface HeapDumpResult {
  heapPath?: string;
  diagPath?: string;
  error?: string;
  success: boolean;
}

/**
 *
 */
export interface MemoryMonitorOptions {
  criticalBytes?: number;
  highBytes?: number;
  warnBytes?: number;
  intervalMs?: number;
  onCritical?: (snap: MemorySnapshot, dump: HeapDumpResult | null) => void;
  onHigh?: (snap: MemorySnapshot, dump: HeapDumpResult | null) => void;
  onWarn?: (snap: MemorySnapshot) => void;
  cooldownMs?: number;
  dumpDir?: string;
}

function isOptIn(): boolean {
  return process.env['GOLI_TUI_HEAPMON'] === '1';
}
function inTest(): boolean {
  return Boolean(process.env['VITEST']);
}

function getLogFilePath(): string {
  const home = process.env['GOLI_HOME']?.trim() || join(homedir(), '.goli-cli');
  return join(home, LOG_DIR_NAME, LOG_FILE_NAME);
}

function resolveThresholds(opts: { criticalBytes?: number; highBytes?: number }): { critical: number; high: number } {
  let ceiling = 0;
  try {
    ceiling = getHeapStatistics().heap_size_limit || 0;
  } catch {
    ceiling = 0;
  }
  const ceilingBytes = ceiling > 0 ? ceiling : CEILING_FALLBACK_GB * GB;
  const critical = opts.criticalBytes ?? Math.max(FLOOR_CRITICAL_BYTES, Math.round(ceilingBytes * CRITICAL_RATIO_DEFAULT));
  const high =
    opts.highBytes ??
    Math.max(
      FLOOR_HIGH_BYTES,
      Math.min(critical - FLOOR_HIGH_MINUS_CRIT_BUFFER, Math.round(ceilingBytes * HIGH_RATIO_DEFAULT)),
    );
  return { critical, high };
}

function heapdumpDir(override?: string): string {
  return (
    override ??
    process.env['GOLI_HEAPDUMP_DIR']?.trim() ??
    join(process.env['GOLI_HOME']?.trim() || join(homedir(), '.goli-cli'), HEAPDUMP_DIR_NAME)
  );
}

/**
 * Best-effort heap dump + companion diagnostics file. Trigger label ends up
 * in the filename so on-disk dumps are self-describing.
 */
async function performHeapDump(trigger: 'auto-critical' | 'auto-high', dir: string): Promise<HeapDumpResult> {
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const heapPath = join(dir, 'goli-tui-' + stamp + '-' + trigger + '.heapsnapshot');
    const diagPath = join(dir, 'goli-tui-' + stamp + '-' + trigger + '.diag.json');
    const opts: HeapSnapshotOptions = { exposeInternals: false, exposeNumericValues: false };
    const snap = getHeapSnapshot(opts);
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(heapPath);
      snap.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    });
    const diag = {
      hostname: hostname(),
      node: process.version,
      pid: process.pid,
      rss: process.memoryUsage().rss,
      timestamp: new Date().toISOString(),
      trigger,
      v8: getHeapStatistics(),
    };
    writeFileSync(diagPath, JSON.stringify(diag, null, 2), 'utf8');
    pruneOldDumps(dir);
    return { success: true, heapPath, diagPath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Synchronous retention — keep the newest N dumps. */
function pruneOldDumps(dir: string): void {
  try {
    const entries = readdirSync(dir)
      .filter((f) => f.endsWith('.heapsnapshot') || f.endsWith('.diag.json'))
      .map((f) => {
        const full = join(dir, f);
        try {
          const s = statSync(full);
          return { full, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(<T,>(v: T | null): v is T => v !== null);
    entries.sort((a, b) => b.mtime - a.mtime);
    for (const e of entries.slice(HEAPDUMP_KEEP * 2)) {
      try {
        unlinkSync(e.full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function recordBreadcrumb(line: string): void {
  if (inTest()) return;
  try {
    appendFileSync(getLogFilePath(), '[tui] ' + new Date().toISOString() + ' ' + line + '\n');
  } catch {
    /* ignore */
  }
}

/**
 * Start the heap-pressure watchdog. Idempotent — second call returns the
 * same stop fn as the first. Default-disabled; opt in via GOLI_TUI_HEAPMON=1.
 *
 * Returns a stop() function. Calling stop() clears the interval.
 */
export function startMemoryMonitor(opts: MemoryMonitorOptions = {}): () => void {
  if (!isOptIn() || inTest()) {
    return () => {};
  }

  const {
    intervalMs = INTERVAL_MS_DEFAULT,
    cooldownMs = COOLDOWN_MS_DEFAULT,
    warnBytes = WARN_BYTES_DEFAULT,
    onCritical,
    onHigh,
    onWarn,
    dumpDir: dumpDirOpt,
  } = opts;

  const { critical, high } = resolveThresholds(opts);
  const dir = heapdumpDir(dumpDirOpt);
  const dumped = new Set<MemoryLevel>();
  const inFlight = new Set<MemoryLevel>();
  let lastHeap = -1;
  let warned = false;
  let lastAutoDumpAt = 0;

  const tick = async (): Promise<void> => {
    const mem = process.memoryUsage();
    const heapUsed = mem.heapUsed;
    const rss = mem.rss;

    // Sub-threshold abnormal-growth warning.
    if (heapUsed < high && lastHeap >= 0) {
      if (!warned && heapUsed >= warnBytes && heapUsed - lastHeap >= WARN_GROWTH_STEP) {
        warned = true;
        recordBreadcrumb(
          'heap-warn heapUsed=' + (heapUsed / MB).toFixed(1) + 'MB delta=' + ((heapUsed - lastHeap) / MB).toFixed(1) + 'MB',
        );
        onWarn?.({ heapUsed, level: 'normal', rss });
      } else if (heapUsed < warnBytes) {
        warned = false;
      }
    }
    lastHeap = heapUsed;

    const level: MemoryLevel = heapUsed >= critical ? 'critical' : heapUsed >= high ? 'high' : 'normal';

    if (level === 'normal') {
      dumped.clear();
      return;
    }
    if (dumped.has(level) || inFlight.has(level)) return;
    if (Date.now() - lastAutoDumpAt < cooldownMs) return;

    inFlight.add(level);
    lastAutoDumpAt = Date.now();
    dumped.add(level);

    const dump = await performHeapDump(level === 'critical' ? 'auto-critical' : 'auto-high', dir).catch(
      () => null,
    );
    const snap: MemorySnapshot = { heapUsed, level, rss };

    recordBreadcrumb(
      'heap-' + level + ' heapUsed=' + (heapUsed / MB).toFixed(1) + 'MB dumpPath=' + (dump?.heapPath ?? '<skipped>'),
    );

    try {
      (level === 'critical' ? onCritical : onHigh)?.(snap, dump);
    } finally {
      inFlight.delete(level);
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  if (handle && typeof handle.unref === 'function') handle.unref();

  return () => clearInterval(handle);
}

/**
 * Returns true if the heap watchdog would be active on the next launch.
 * Tests / debug overlays read this without spinning up the timer.
 */
export function isHeapMonitorEnabled(): boolean {
  return isOptIn();
}
