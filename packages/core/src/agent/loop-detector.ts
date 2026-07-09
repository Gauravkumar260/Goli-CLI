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

/** The type of loop detected. */
export type LoopType = 'tool_call' | 'content';

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

  // Sliding windows of recent items.
  private recentToolCalls: string[] = []; // hashes of (name + args)
  private recentContents: string[] = []; // hashes of content
  private consecutiveToolCallCount = 0;
  private consecutiveContentCount = 0;
  private lastToolCallHash: string | null = null;
  private lastContentHash: string | null = null;

  constructor(opts: LoopDetectorOptions = {}) {
    this.toolCallThreshold = opts.toolCallThreshold ?? TOOL_CALL_LOOP_THRESHOLD;
    this.contentThreshold = opts.contentThreshold ?? CONTENT_LOOP_THRESHOLD;
    this.maxHistory = opts.maxHistory ?? MAX_HISTORY_LENGTH;
    this.onLoopDetected = opts.onLoopDetected;
  }

  /**
   * Record a tool call and check for a loop.
   * Returns a `LoopDetectionError` if a loop is detected, or `null` otherwise.
   */
  recordToolCall(call: ToolCallRecord): LoopDetectionError | null {
    const hash = hashToolCall(call);
    if (hash === this.lastToolCallHash) {
      this.consecutiveToolCallCount++;
    } else {
      this.consecutiveToolCallCount = 1;
      this.lastToolCallHash = hash;
    }

    this.recentToolCalls.push(hash);
    if (this.recentToolCalls.length > this.maxHistory) {
      this.recentToolCalls.shift();
    }

    if (this.consecutiveToolCallCount >= this.toolCallThreshold) {
      const event: LoopDetectedEvent = {
        type: 'tool_call',
        count: this.consecutiveToolCallCount,
        threshold: this.toolCallThreshold,
        description: `${call.name}(${truncate(JSON.stringify(call.args ?? {}) ?? '{}', 80)})`,
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

    this.recentContents.push(hash);
    if (this.recentContents.length > this.maxHistory) {
      this.recentContents.shift();
    }

    if (this.consecutiveContentCount >= this.contentThreshold) {
      const event: LoopDetectedEvent = {
        type: 'content',
        count: this.consecutiveContentCount,
        threshold: this.contentThreshold,
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
    this.recentToolCalls = [];
    this.recentContents = [];
    this.consecutiveToolCallCount = 0;
    this.consecutiveContentCount = 0;
    this.lastToolCallHash = null;
    this.lastContentHash = null;
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
  const argsStr = JSON.stringify(call.args ?? {}) ?? '{}';
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
