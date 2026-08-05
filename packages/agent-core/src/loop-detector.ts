/**
 * agent/loop-detector.ts — Detects repeated identical tool calls / content outputs.
 *
 * Mirrors gemini-cli's `loopDetectionService.ts` deterministic subset:
 *   - Tool-call loop: N consecutive identical tool calls (same name + same args).
 *     Default threshold: 5.
 *   - Content loop: N consecutive similar content outputs (same hash).
 *     Default threshold: 10.
 *
 * When a loop is detected, emits a `LoopDetected` event + returns a structured
 * error that the agent loop can use to break out.
 *
 * The LLM-based semantic loop check (gemini-cli's full implementation) is
 * intentionally omitted — it requires an LLM round-trip and is not deterministic.
 * This module is the deterministic fast path.
 *
 * @module loop-detector
 */

import { createHash } from 'node:crypto';

/** Default threshold for consecutive identical tool calls. */
export const TOOL_CALL_LOOP_THRESHOLD = 5;

/** Default threshold for consecutive similar content outputs. */
export const CONTENT_LOOP_THRESHOLD = 10;

/** Max history to keep (sliding window). */
export const MAX_HISTORY_LENGTH = 5000;

/**
 * P1-17: Default threshold for cycle detection. A cycle of length L
 * must repeat this many times to be flagged. Default 3 (so
 * A→B→A→B→A→B = 3 reps of length-2 = flagged).
 */
export const CYCLE_THRESHOLD = 3;

/**
 * P1-17: Max cycle length to check. The detector checks patterns of
 * length 2 up to this value. Default 4.
 */
export const MAX_CYCLE_LENGTH = 4;

/** The type of loop detected. */
export type LoopType = 'tool_call' | 'content' | 'tool_call_cycle';

/** A loop detection event. */
export interface LoopDetectedEvent {
  /** The type of loop. */
  type: LoopType;
  /** The number of consecutive repetitions detected. */
  count: number;
  /** The threshold that was exceeded. */
  threshold: number;
  /** A description of the repeated item (tool name + args, or content hash). */
  description: string;
  /** Timestamp (ms since epoch). */
  timestamp: number;
}

/** A structured error returned when a loop is detected. */
export interface LoopDetectionError {
  /** Always `'LoopDetected'`. */
  code: 'LoopDetected';
  /** The loop detection event. */
  event: LoopDetectedEvent;
  /** Human-readable message. */
  message: string;
}

/** Options for {@link LoopDetector}. */
export interface LoopDetectorOptions {
  /** Threshold for consecutive identical tool calls. Default 5. */
  toolCallThreshold?: number;
  /** Threshold for consecutive similar content outputs. Default 10. */
  contentThreshold?: number;
  /** Max history to keep. Default 5000. */
  maxHistory?: number;
  /** Callback invoked when a loop is detected. */
  onLoopDetected?: (event: LoopDetectedEvent) => void;
  /**
   * P1-17: threshold for cycle detection. A "cycle" is a repeating
   * pattern of length `cycleLength` — e.g. A→B→A→B is a cycle of
   * length 2. The detector flags a cycle when it sees the same
   * pattern repeat `cycleThreshold` times consecutively. Default 3
   * (so A→B→A→B→A→B = 3 repetitions of length-2 = flagged).
   */
  cycleThreshold?: number;
  /**
   * P1-17: max cycle length to check. The detector checks patterns
   * of length 2 up to `maxCycleLength`. Default 4 (so it catches
   * A→B→A→B, A→B→C→A→B→C, A→B→C→D→A→B→C→D but not longer).
   */
  maxCycleLength?: number;
}

/** A single tool call record for loop detection. */
export interface ToolCallRecord {
  /** Tool name. */
  name: string;
  /** Tool arguments (JSON-serialized for comparison). */
  args: unknown;
}

/**
 * LoopDetector — deterministic detection of repeated identical tool calls
 * and content outputs.
 *
 * Usage:
 *   const detector = new LoopDetector({ toolCallThreshold: 5 });
 *   for (const call of toolCalls) {
 *     const loop = detector.recordToolCall(call);
 *     if (loop) {
 *       console.error('Loop detected:', loop.message);
 *       break;
 *     }
 *   }
 */
export class LoopDetector {
  private readonly toolCallThreshold: number;
  private readonly contentThreshold: number;
  private readonly maxHistory: number;
  private readonly onLoopDetected?: (event: LoopDetectedEvent) => void;
  /**
   * P1-17: cycle-detection config. The detector keeps a sliding
   * window of recent tool-call hashes (`cycleWindow`) and checks
   * each length from 2 to `maxCycleLength` for a repeating pattern.
   * When the same pattern repeats `cycleThreshold` times, the cycle
   * is flagged.
   */
  private readonly cycleThreshold: number;
  private readonly maxCycleLength: number;
  private cycleWindow: string[] = [];

  // Sliding windows of recent items.
  //
  // NOTE: `recentToolCalls` and `recentContents` arrays are STORED
  // but never READ — the loop-detection logic uses only
  // `lastToolCallHash` / `lastContentHash` and
  // `consecutiveToolCallCount` / `consecutiveContentCount`. The
  // previous implementation pushed to these arrays and called
  // `Array.shift()` on every record — `shift()` is O(n) (re-indexes
  // every element), so 5,000 entries × 5,000 records = 25M element
  // moves over the detector's lifetime. We now drop the unused
  // arrays entirely. They were likely intended for a future
  // "find repeated tool calls within last N" feature; if that's
  // added, use a `Set<string>` (or a `Map<string, number>` for
  // counts) with explicit eviction, not an `Array.shift()`.
  private consecutiveToolCallCount = 0;
  private consecutiveContentCount = 0;
  private lastToolCallHash: string | null = null;
  private lastContentHash: string | null = null;

  constructor(opts: LoopDetectorOptions = {}) {
    this.toolCallThreshold = opts.toolCallThreshold ?? TOOL_CALL_LOOP_THRESHOLD;
    this.contentThreshold = opts.contentThreshold ?? CONTENT_LOOP_THRESHOLD;
    this.maxHistory = opts.maxHistory ?? MAX_HISTORY_LENGTH;
    this.onLoopDetected = opts.onLoopDetected;
    this.cycleThreshold = opts.cycleThreshold ?? CYCLE_THRESHOLD;
    this.maxCycleLength = opts.maxCycleLength ?? MAX_CYCLE_LENGTH;
  }

  /**
   * Record a tool call and check for a loop.
   * Returns a `LoopDetectionError` if a loop is detected, or `null` otherwise.
   *
   * P1-17: now also checks for cycles (A→B→A→B) in addition to
   * consecutive identical calls. The cycle check runs AFTER the
   * consecutive-identical check (which is stricter — a consecutive
   * loop is a degenerate cycle of length 1).
   */
  recordToolCall(call: ToolCallRecord): LoopDetectionError | null {
    const hash = hashToolCall(call);
    if (hash === this.lastToolCallHash) {
      this.consecutiveToolCallCount++;
    } else {
      this.consecutiveToolCallCount = 1;
      this.lastToolCallHash = hash;
    }
    // Previously: this.recentToolCalls.push(hash); this.recentToolCalls.shift();
    // Removed — see comment on `consecutiveToolCallCount` above.


    if (this.consecutiveToolCallCount >= this.toolCallThreshold) {
      const event: LoopDetectedEvent = {
        type: 'tool_call',
        count: this.consecutiveToolCallCount,
        threshold: this.toolCallThreshold,
        // 80-char cap keeps the description readable in TUI logs without wrapping.
        description: `${call.name}(${truncate(JSON.stringify(call.args ?? {}), 80)})`,
        timestamp: Date.now(),
      };
      const error: LoopDetectionError = {
        code: 'LoopDetected',
        event,
        message: `Tool-call loop detected: ${call.name} called ${this.consecutiveToolCallCount} times consecutively with identical args.`,
      };
      this.onLoopDetected?.(event);
      return error;
    }

    // P1-17: cycle detection. Push the hash into the sliding window
    // and check for repeating patterns of length 2..maxCycleLength.
    // The window is capped at `maxCycleLength * cycleThreshold` so
    // memory is bounded (max 4 * 3 = 12 entries by default).
    this.cycleWindow.push(hash);
    const maxWindow = this.maxCycleLength * this.cycleThreshold;
    if (this.cycleWindow.length > maxWindow) {
      this.cycleWindow.shift();
    }
    const cycle = this.detectCycle();
    if (cycle !== null) {
      const [cycleLen, reps] = cycle;
      const event: LoopDetectedEvent = {
        type: 'tool_call_cycle',
        count: reps,
        threshold: this.cycleThreshold,
        description: `${call.name} in a length-${cycleLen} cycle repeated ${reps} times`,
        timestamp: Date.now(),
      };
      const error: LoopDetectionError = {
        code: 'LoopDetected',
        event,
        message: `Tool-call cycle detected: length-${cycleLen} pattern repeated ${reps} times (e.g. A→B→A→B→A→B). The agent is alternating between tools without making progress.`,
      };
      this.onLoopDetected?.(event);
      return error;
    }

    return null;
  }

  /**
   * P1-17: detect a repeating cycle in `cycleWindow`.
   *
   * Checks each pattern length from 2 up to `maxCycleLength`. For
   * each length L, examines the last L * cycleThreshold entries and
   * checks if they consist of `cycleThreshold` repetitions of the
   * same L-length pattern.
   *
   * Returns `[cycleLength, repetitions]` on the first match, or
   * `null` if no cycle is detected.
   */
  private detectCycle(): [number, number] | null {
    const w = this.cycleWindow;
    for (let cycleLen = 2; cycleLen <= this.maxCycleLength; cycleLen++) {
      const needed = cycleLen * this.cycleThreshold;
      if (w.length < needed) continue;
      // Take the last `needed` entries and check if they're
      // `cycleThreshold` repetitions of the same `cycleLen`-length
      // pattern.
      const recent = w.slice(-needed);
      const pattern = recent.slice(0, cycleLen);
      // P1-17: skip degenerate cycles where all elements in the
      // pattern are identical — that's the consecutive-identical
      // case, already handled by `toolCallThreshold` above. Firing
      // here would double-report and also confuse the user (a
      // "length-2 cycle" of [A, A] is just "A repeated").
      const allSame = pattern.every((p) => p === pattern[0]);
      if (allSame) continue;
      let isCycle = true;
      for (let rep = 1; rep < this.cycleThreshold; rep++) {
        for (let i = 0; i < cycleLen; i++) {
          if (recent[rep * cycleLen + i] !== pattern[i]) {
            isCycle = false;
            break;
          }
        }
        if (!isCycle) break;
      }
      if (isCycle) {
        return [cycleLen, this.cycleThreshold];
      }
    }
    return null;
  }

  /**
   * Record a content output and check for a loop.
   * Returns a `LoopDetectionError` if a loop is detected, or `null` otherwise.
   */
  recordContent(content: string): LoopDetectionError | null {
    const hash = hashContent(content);
    if (hash === this.lastContentHash) {
      this.consecutiveContentCount++;
    } else {
      this.consecutiveContentCount = 1;
      this.lastContentHash = hash;
    }
    // Previously: this.recentContents.push(hash); this.recentContents.shift();
    // Removed — see comment on `consecutiveContentCount` above.

    if (this.consecutiveContentCount >= this.contentThreshold) {
      const event: LoopDetectedEvent = {
        type: 'content',
        count: this.consecutiveContentCount,
        threshold: this.contentThreshold,
        // First 16 hex chars of the SHA-256 — enough to be uniquely
        // identifiable in logs without the full 64-char hash.
        description: `content hash=${hash.slice(0, 16)}…`,
        timestamp: Date.now(),
      };
      const error: LoopDetectionError = {
        code: 'LoopDetected',
        event,
        message: `Content loop detected: identical content produced ${this.consecutiveContentCount} times consecutively.`,
      };
      this.onLoopDetected?.(event);
      return error;
    }
    return null;
  }

  /** Reset the detector's state (for a new turn). */
  reset(): void {
    // (recentToolCalls / recentContents arrays removed — see above.)
    this.consecutiveToolCallCount = 0;
    this.consecutiveContentCount = 0;
    this.lastToolCallHash = null;
    this.lastContentHash = null;
    // P1-17: clear the cycle-detection window.
    this.cycleWindow = [];
  }

  /** Get the current consecutive tool-call count (for diagnostics). */
  getConsecutiveToolCallCount(): number {
    return this.consecutiveToolCallCount;
  }

  /** Get the current consecutive content count (for diagnostics). */
  getConsecutiveContentCount(): number {
    return this.consecutiveContentCount;
  }
}

// ─── Hashing helpers ─────────────────────────────────────────────────────

/** Hash a tool call (name + args) into a deterministic string. */
function hashToolCall(call: ToolCallRecord): string {
  const argsStr = JSON.stringify(call.args ?? {});
  return createHash('sha256')
    .update(call.name)
    .update('\0')
    .update(argsStr)
    .digest('hex');
}

/** Hash content into a deterministic string. */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Truncate a string to `max` chars, with ellipsis if truncated. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve 1 char for the ellipsis so the result fits within `max`.
  return s.slice(0, max - 1) + '…';
}

/**
 * Check if a sequence of tool calls contains a loop.
 * Standalone function (no state) — useful for one-shot checks.
 *
 * @param calls - The sequence of tool calls to check.
 * @param threshold - Minimum consecutive identical calls to be a loop. Default 5.
 * @returns The loop detection error if a loop is found, or null.
 */
export function detectToolCallLoop(
  calls: ToolCallRecord[],
  threshold: number = TOOL_CALL_LOOP_THRESHOLD,
): LoopDetectionError | null {
  const detector = new LoopDetector({ toolCallThreshold: threshold });
  for (const call of calls) {
    const loop = detector.recordToolCall(call);
    if (loop) return loop;
  }
  return null;
}

/**
 * Check if a sequence of content outputs contains a loop.
 * Standalone function (no state) — useful for one-shot checks.
 *
 * @param contents - The sequence of content strings to check.
 * @param threshold - Minimum consecutive identical contents to be a loop. Default 10.
 * @returns The loop detection error if a loop is found, or null.
 */
export function detectContentLoop(
  contents: string[],
  threshold: number = CONTENT_LOOP_THRESHOLD,
): LoopDetectionError | null {
  const detector = new LoopDetector({ contentThreshold: threshold });
  for (const content of contents) {
    const loop = detector.recordContent(content);
    if (loop) return loop;
  }
  return null;
}
