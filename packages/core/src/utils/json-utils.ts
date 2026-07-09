/**
 * JSON serialization helpers.
 *
 * @module utils/json-utils
 */

/**
 * Recursively sort object keys for deterministic JSON serialization.
 *
 * Produces a new value where every plain-object's keys appear in
 * alphabetical order. Arrays are walked element-by-element; primitives
 * are returned as-is. Useful when serializing tool-call arguments (or
 * any other hashable payload) into a cache key or a stable log line,
 * where key-order must not affect the output.
 *
 * Extracted during dedup loop iteration 4 from previously-byte-identical
 * copies in `packages/core/src/agent/stall-detector.ts` and
 * `packages/core/src/agent/tool-guardrails.ts`. Behavior is identical
 * to both originals.
 *
 * @param obj - Any value. The function is total — never throws.
 * @returns A new value with sorted keys (or the original primitive).
 */
export function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}
