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
 * ## Cycle detection
 *
 * The previous implementation recursed without tracking visited
 * objects — a circular reference (`a.self = a`) caused infinite
 * recursion and a stack overflow. We now use a `WeakSet` to track
 * the current visit path and return `'[Circular]'` when a cycle is
 * detected (mirroring the behavior of `flatted` / `safe-stable-stringify`).
 *
 * ## Plain-object check
 *
 * The previous implementation walked `Object.keys(obj)` on ANY
 * object, including class instances, Maps, Sets, and Buffers. For
 * class instances this iterated enumerable own properties (which is
 * usually fine), but for Maps and Sets it produced `{}` (no own
 * enumerable props) and for Buffers it produced a 512-element
 * "object" of byte values. We now check for plain objects explicitly
 * (objects whose prototype is `Object.prototype` or `null`) and
 * stringify non-plain objects via `String(obj)` instead.
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
  const seen = new WeakSet<object>();
  const recurse = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      const result = value.map(recurse);
      seen.delete(value);
      return result;
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      try {
        // Only treat "plain" objects (Object.prototype or null proto)
        // as key-bags. Class instances, Maps, Sets, Buffers, etc. are
        // stringified via String() to avoid leaking internal state.
        const proto = Object.getPrototypeOf(value);
        const isPlain = proto === Object.prototype || proto === null;
        if (!isPlain) {
          return String(value);
        }
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[key] = recurse((value as Record<string, unknown>)[key]);
        }
        return sorted;
      } finally {
        seen.delete(value);
      }
    }
    return value;
  };
  return recurse(obj);
}
