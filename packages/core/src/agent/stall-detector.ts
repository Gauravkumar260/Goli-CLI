/**
 * Stall detector (Module 1).
 *
 * Detects when the agent is stuck in a loop — making the same tool call
 * with identical arguments 3 times in a row. This is the safeguard
 * against the November 2025 LangChain incident where 4 agents ran for
 * 11 days and racked up a $47,000 bill (ADR-0011).
 *
 * ## How it works
 *
 * After each tool call, we compute a "signature" — a deterministic
 * string combining the tool name and the (parsed, sorted) arguments.
 * We keep a sliding window of the last N signatures (default 5). If the
 * last 3 signatures are identical, we fire `detected = true`.
 *
 * The window is larger than the threshold (5 > 3) to avoid false
 * positives from legitimate repeated calls (e.g. reading 3 different
 * files with `read_file`).
 *
 * @module agent/stall-detector
 */

import { sortObjectKeys } from '@goli-cli/shared/utils/json-utils.js';

import type { ToolCall } from './types.js';
import type { StallConfig } from '@goli-cli/config/schema.js';

/**
 * Stall detector — detects repeated identical tool calls.
 *
 * @module agent/stall-detector
 */
export class StallDetector {
  private readonly threshold: number;
  private readonly windowSize: number;
  private readonly signatures: string[] = [];

  constructor(config: StallConfig) {
    this.threshold = config.identicalCallThreshold;
    this.windowSize = config.windowSize;
  }

  /**
   * Record a tool call and check for stall.
   *
   * @param toolCall - The tool call that was just made.
   * @returns `true` if a stall is detected (3+ identical calls in a row).
   */
  recordAndCheck(toolCall: ToolCall): boolean {
    const sig = this.signature(toolCall);
    this.signatures.push(sig);

    // Trim to window size
    while (this.signatures.length > this.windowSize) {
      this.signatures.shift();
    }

    // Check if the last `threshold` signatures are identical
    if (this.signatures.length < this.threshold) return false;
    const tail = this.signatures.slice(-this.threshold);
    const first = tail[0];
    return tail.every((s) => s === first);
  }

  /**
   * Compute a deterministic signature for a tool call.
   *
   * The signature is `name + ':' + sortedArgs` where `sortedArgs` is the
   * JSON-stringified arguments with keys sorted. This ensures that
   * `{"b": 2, "a": 1}` and `{"a": 1, "b": 2}` produce the same signature.
   *
   * Important: when `argumentsParsed` is missing (JSON parse failed), we
   * fall back to the raw `arguments` string. Otherwise two failed-parse
   * calls with *different* raw arguments would produce the same signature
   * (`name:{}`) and trigger a false stall detection — defeating the
   * detector's purpose of catching genuine loops.
   * @param toolCall
   */
  private signature(toolCall: ToolCall): string {
    // If parsing failed, use the raw arguments string so that two malformed
    // calls with different content don't collide on `name:{}`.
    // Normalize whitespace so that semantically identical calls
    // with different formatting (e.g., `{"a":1}` vs `{"a": 1}`)
    // produce the same signature. The previous implementation
    // used the raw string verbatim — two semantically identical
    // calls with different JSON formatting would produce different
    // signatures, missing the stall.
    if (toolCall.parseError || !toolCall.argumentsParsed) {
      const normalized = toolCall.arguments.replace(/\s+/g, ' ').trim();
      return `${toolCall.name}:RAW:${normalized}`;
    }
    const sorted = sortObjectKeys(toolCall.argumentsParsed);
    return `${toolCall.name}:${JSON.stringify(sorted)}`;
  }

  /**
   * Reset the detector (e.g. after a successful non-stalled iteration).
   */
  reset(): void {
    this.signatures.length = 0;
  }

  /**
   * Get the current signature window (for debugging).
   */
  getSignatures(): string[] {
    return [...this.signatures];
  }
}
