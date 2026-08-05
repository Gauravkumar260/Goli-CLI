/**
 * lib/circularBuffer.ts — Fixed-capacity ring buffer.
 *
 * Direct port of hermes-agent/lib/circularBuffer.ts. Pure data structure,
 * zero rendering / zero visible effect when used. Designed for the
 * "last-N items" pattern: it overwrites the oldest entry once full and
 * keeps the `tail(n)` API stable for any slice.
 *
 * Performance note (no design change): avoids the array `.shift()` cost
 * (which is O(N) on every insert) by tracking head + length separately
 * and indexing modularly. Push is O(1) amortised, tail(n) is O(n).
 *
 * Usage:
 *   const buf = new CircularBuffer<string>(800);
 *   buf.push(line);
 *   const recent = buf.tail();   // up to 800 in insertion order
 */
export class CircularBuffer<T> {
  private buf: T[];
  private head = 0;
  private len = 0;

  constructor(private capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        `CircularBuffer capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.buf = new Array<T>(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.len < this.capacity) this.len++;
  }

  /**
   * Return the last `n` items in insertion order. If `n` exceeds the current
   * length, returns everything we have. If `n <= 0`, returns an empty array.
   */
  tail(n: number = this.len): T[] {
    const take = Math.min(Math.max(0, n), this.len);
    const start = this.len < this.capacity ? 0 : this.head;
    const out: T[] = new Array<T>(take);
    for (let i = 0; i < take; i++) {
      out[i] = this.buf[(start + this.len - take + i) % this.capacity]!;
    }
    return out;
  }

  /** Snapshot and clear. */
  drain(): T[] {
    const out = this.tail();
    this.clear();
    return out;
  }

  clear(): void {
    this.buf = new Array<T>(this.capacity);
    this.head = 0;
    this.len = 0;
  }

  /** Current population (0..capacity). */
  size(): number {
    return this.len;
  }

  /** Configured capacity. */
  getCapacity(): number {
    return this.capacity;
  }
}
