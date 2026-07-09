/**
 * Shared benchmarking utilities for the `scripts/bench.ts` and
 * `scripts/tti-bench.ts` runners.
 *
 * Extracted during dedup loop iteration 5 from previously-byte-identical
 * copies in `scripts/bench.ts:52-65` and `scripts/tti-bench.ts:50-63`.
 * Behavior is identical to both originals.
 *
 * @module scripts/bench-utils
 */

/**
 * Time a synchronous function in milliseconds using a high-resolution
 * monotonic clock (`process.hrtime.bigint()`).
 *
 * @param fn - The synchronous function to time.
 * @returns Elapsed time in milliseconds (float, ns precision).
 */
export function timeMs(fn: () => void): number {
  const startNs = process.hrtime.bigint();
  fn();
  const endNs = process.hrtime.bigint();
  return Number(endNs - startNs) / 1_000_000; // ns -> ms
}

/**
 * Compute the median of a list of numbers.
 *
 * For an even-length list, returns the mean of the two middle values.
 * For an odd-length list, returns the middle value.
 *
 * @param values - The input samples (order is irrelevant — the function
 *   sorts a copy and does not mutate the caller's array).
 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
