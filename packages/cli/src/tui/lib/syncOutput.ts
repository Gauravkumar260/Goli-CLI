/**
 * lib/syncOutput.ts — DEC Synchronized Output + batched stdout writes.
 *
 * Source: GOLI_CLI_TUI_DEEP_RESEARCH.md §6.1 (The Three-Layer
 * Performance Stack) — Layer 2 + Layer 3.
 *
 *   Layer 1 — Double Buffering            (handled by Ink internally)
 *   Layer 2 — DEC Synchronized Output     (this module)
 *   Layer 3 — Batched Writes              (this module)
 *
 * DEC Synchronized Output wraps each frame in:
 *
 *     CSI ?2026 h  <frame>  CSI ?2026 l
 *
 * The terminal buffers everything between the two markers and renders
 * the whole frame atomically — zero flicker even when many lines change
 * at once. This is the single change Gemini CLI shipped in their Nov 2025
 * "rendering overhaul" blog post.
 *
 * We only enable this when:
 *   - the terminal advertises support (capabilities.ts), AND
 *   - we are not in accessibility mode.
 *
 * IMPORTANT — this module does NOT change the visual output. Every
 * byte written by Ink is preserved verbatim. We only:
 *   1. Wrap the byte stream in CSI ?2026 h / CSI ?2026 l markers, AND
 *   2. Coalesce small writes into larger ones (one syscall instead of
 *      many) to reduce tearing.
 *
 * The original Ink stdout remains untouched on terminals that don't
 * support sync output. The user sees the same UI either way.
 *
 * Performance tuning (no design change):
 *   - Frame deadline uses monotonic elapsed time, not a fresh setTimeout
 *     per write. A burst of N writes within one frame now flushes ONCE
 *     at the frame boundary instead of scheduling/stack-clearing N timers.
 *   - The frame deadline fires on the fastest of: next setImmediate,
 *     next macrotask, or MAX_FRAME_MS wall-clock. setImmediate yields
 *     to Ink's render but doesn't introduce the 1-2ms setTimeout floor.
 *   - MAX_BUFFER_BYTES raised to 256 KB so a multi-line code block dump
 *     inside a streaming markdown response never fragments mid-frame.
 */
import process from 'node:process';
import { detectCapabilities } from './capabilities.js';

const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

// Flush thresholds. We flush the pending frame buffer when ANY of:
//   - the buffer exceeds MAX_BUFFER_BYTES (avoid unbounded growth), OR
//   - MAX_FRAME_MS elapses since the first byte of the frame (~60 FPS cap).
const MAX_BUFFER_BYTES = 256 * 1024;
const MAX_FRAME_MS = 16;

let enabled = false;
let installed = false;

let frameBuf = '';
let frameDeadline = 0;
let frameHandle: ReturnType<typeof setImmediate> | null = null;

/**
 * Install the sync-output interceptor on process.stdout. Called once
 * at startup, BEFORE Ink's `render()`.
 *
 * If the terminal doesn't support sync output, this is a no-op —
 * Ink's default behavior is preserved exactly.
 */
export function installSyncOutput(): void {
  if (installed) return;
  installed = true;

  const caps = detectCapabilities();
  if (!caps.syncOutput || caps.accessibility) {
    // No-op — Ink's default stdout is already correct.
    return;
  }
  enabled = true;

  const realWrite = process.stdout.write.bind(process.stdout);

  const doFlush = (): void => {
    if (frameHandle !== null) {
      // setImmediate handles are not in Node's Timeout tree (no clearImmediate
      // needed); we still null the slot so we can re-schedule on burst.
      frameHandle = null;
    }
    if (frameBuf.length === 0) return;
    const out = frameBuf + SYNC_END;
    frameBuf = '';
    // Single syscall — atomic from the kernel's perspective.
    realWrite(out);
  };

  const scheduleFlush = (): void => {
    if (frameHandle !== null) return;
    // setImmediate runs after all I/O callbacks but before timers, with no
    // setTimeout floor. This is the closest Node offers to "next event-loop
    // tick" without incurring the 1ms minimum that setTimeout(fn,0) imposes
    // (and that adds up over a long streaming session).
    frameHandle = setImmediate(doFlush);
    if (frameHandle && typeof frameHandle.unref === 'function') {
      frameHandle.unref();
    }
  };

  // Replace process.stdout.write with our batched, sync-wrapped version.
  // Ink calls process.stdout.write(chunk) on every render — we intercept.
  process.stdout.write = ((chunk: unknown): boolean => {
    const data =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);

    // First write of a frame: stamp the deadline and emit CSI ?2026 h.
    if (frameBuf.length === 0) {
      frameBuf = SYNC_START;
      frameDeadline = Date.now() + MAX_FRAME_MS;
    }
    frameBuf += data;

    if (frameBuf.length >= MAX_BUFFER_BYTES) {
      // Hard ceiling — flush right now.
      doFlush();
    } else if (!frameHandle) {
      const now = Date.now();
      const remaining = frameDeadline - now;
      if (remaining <= 0) {
        // Deadline already passed — flush immediately on next tick.
        scheduleFlush();
      } else {
        // We're still inside the current frame window. Defer until either
        // the deadline or next tick — whichever fires first.
        // setImmediate has no delay (it picks the next available tick),
        // so this is always <= remaining, no use scheduling a setTimeout.
        scheduleFlush();
      }
    }
    return true;
  }) as typeof process.stdout.write;

  // On process exit, emit any pending SYNC_END and flush.
  process.on('beforeExit', doFlush);
  process.on('exit', () => {
    // Synchronous-only — no setImmediate here.
    if (frameBuf.length > 0) {
      realWrite(frameBuf + SYNC_END);
      frameBuf = '';
    }
  });
}

/**
 * Returns true if DEC Synchronized Output is active. Useful for tests.
 */
export function isSyncOutputEnabled(): boolean {
  return enabled;
}
