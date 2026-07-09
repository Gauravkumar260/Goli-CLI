/**
 * Unit tests for the CircularBuffer.
 */

import { describe, it, expect } from 'vitest';

import { CircularBuffer } from '../../packages/cli/src/tui/lib/circularBuffer.js';

describe('CircularBuffer', () => {
  it('pushes and tails items within capacity', () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.tail()).toEqual([1, 2, 3]);
    expect(buf.size()).toBe(3);
  });

  it('overwrites oldest items when over capacity', () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1
    expect(buf.tail()).toEqual([2, 3, 4]);
    expect(buf.size()).toBe(3);
  });

  it('tail(n) returns the last n items', () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.tail(2)).toEqual([3, 4]);
    expect(buf.tail(1)).toEqual([4]);
  });

  it('drain returns all items and clears', () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    const drained = buf.drain();
    expect(drained).toEqual([1, 2]);
    expect(buf.size()).toBe(0);
  });

  it('clear empties the buffer', () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.tail()).toEqual([]);
  });

  it('getCapacity returns the capacity', () => {
    const buf = new CircularBuffer<number>(5);
    expect(buf.getCapacity()).toBe(5);
  });

  it('throws on invalid capacity', () => {
    expect(() => new CircularBuffer<number>(0)).toThrow(RangeError);
    expect(() => new CircularBuffer<number>(-1)).toThrow(RangeError);
    expect(() => new CircularBuffer<number>(1.5)).toThrow(RangeError);
  });
});
