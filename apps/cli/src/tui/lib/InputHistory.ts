/**
 * lib/InputHistory.ts — Persistent input history with circular buffer.
 *
 * T-038 (loop run 4): closes a UI gap vs gemini-cli, which has a 1933-line
 * InputPrompt.tsx with full history navigation, vim mode, and suggestions.
 *
 * This module provides the history data structure + persistence; the
 * PromptInput component wires it into Up/Dn arrow key handling.
 *
 * Storage format:
 *   ~/.goli/history  — newline-delimited UTF-8 text file.
 *   Lines are appended on every submission. Duplicates are skipped if the
 *   new entry matches the most recent one. The file is capped at MAX_ENTRIES
 *   lines (oldest entries are truncated from the top).
 *
 * In-memory representation:
 *   CircularBuffer<string> with capacity MAX_ENTRIES. Index 0 = oldest,
 *   Index length-1 = newest. `navigateUp()` decrements the cursor (toward
 *   older entries); `navigateDown()` increments it (toward newer entries).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Maximum number of history entries to keep (in-memory + on-disk). */
export const MAX_HISTORY_ENTRIES = 100;

/** Normalize path separators to forward slashes (path.join() yields `\` on Windows). */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Get the path to the history file.
 *
 * Resolution order:
 *   1. GOLI_HOME env var → $GOLI_HOME/history
 *   2. ~/.goli/current symlink → ~/.goli/current/history
 *   3. ~/.goli-cli/history (legacy default)
 *
 * This mirrors the getGoliHome() resolution from apps/cli/src/commands/profile.ts.
 */
export function getHistoryFilePath(): string {
  // os.homedir() does NOT read $HOME on Windows (it uses the profile dir);
  // honor $HOME first so tests and custom setups can override the home.
  const home = process.env.HOME || homedir();
  const goliHome = process.env['GOLI_HOME'];
  if (goliHome && goliHome.length > 0) {
    return normalizeSeparators(join(goliHome, 'history'));
  }
  // Check ~/.goli/current (active profile)
  const profilePath = join(home, '.goli', 'current');
  if (existsSync(profilePath)) {
    try {
      const profile = readFileSync(profilePath, 'utf-8').trim();
      if (profile.length > 0) {
        return normalizeSeparators(join(home, '.goli', 'profiles', profile, 'history'));
      }
    } catch {
      // Fall through to legacy default.
    }
  }
  return normalizeSeparators(join(home, '.goli-cli', 'history'));
}

/**
 * In-memory input history with cursor-based navigation.
 *
 * The cursor represents the user's current position in the history.
 *   cursor = length  → "live" input (not navigating history)
 *   cursor = length-1 → newest history entry
 *   cursor = 0       → oldest history entry
 *
 * `navigateUp()` (press Up arrow) moves toward older entries.
 * `navigateDown()` (press Down arrow) moves toward newer entries.
 *   When the cursor returns to `length`, the user is back to live input.
 */
export class InputHistory {
  private entries: string[] = [];
  private cursor: number = 0;
  private readonly maxEntries: number;
  private readonly filePath: string | null;

  constructor(opts?: { maxEntries?: number; filePath?: string | null }) {
    this.maxEntries = opts?.maxEntries ?? MAX_HISTORY_ENTRIES;
    this.filePath = opts?.filePath !== undefined ? opts.filePath : getHistoryFilePath();
    this.load();
  }

  /** Load history from disk into memory. */
  private load(): void {
    if (this.filePath === null) return;
    try {
      if (!existsSync(this.filePath)) return;
      const content = readFileSync(this.filePath, 'utf-8');
      // Split on newlines; filter empty lines; cap to maxEntries.
      const lines = content.split('\n').filter((l) => l.length > 0);
      // If more than maxEntries, keep only the most recent.
      this.entries = lines.length > this.maxEntries
        ? lines.slice(lines.length - this.maxEntries)
        : lines;
      this.cursor = this.entries.length;
    } catch {
      // Ignore read errors — start with empty history.
      this.entries = [];
      this.cursor = 0;
    }
  }

  /** Persist a new entry to disk (append-only). */
  private persist(entry: string): void {
    if (this.filePath === null) return;
    try {
      // Ensure parent directory exists.
      const dir = this.filePath.split('/').slice(0, -1).join('/');
      if (dir.length > 0) mkdirSync(dir, { recursive: true });
      appendFileSync(this.filePath, entry + '\n', 'utf-8');
    } catch {
      // Ignore write errors — history is best-effort.
    }
  }

  /**
   * Add a new entry to the history.
   *
   * - Empty/whitespace-only entries are skipped.
   * - Duplicate entries (matching the most recent) are skipped.
   * - When the buffer is full, the oldest entry is dropped.
   * - The cursor is reset to `length` (live input).
   * - The entry is persisted to disk.
   */
  add(entry: string): void {
    const trimmed = entry.trim();
    if (trimmed.length === 0) return;
    // Skip if duplicate of most recent.
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      this.cursor = this.entries.length;
      return;
    }
    this.entries.push(trimmed);
    // Cap to maxEntries.
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.cursor = this.entries.length;
    this.persist(trimmed);
  }

  /**
   * Navigate up (toward older entries).
   * Returns the entry at the new cursor position, or null if at the oldest.
   */
  navigateUp(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor > 0) {
      this.cursor--;
    }
    return this.entries[this.cursor] ?? null;
  }

  /**
   * Navigate down (toward newer entries).
   * Returns the entry at the new cursor position, or null if back to live
   * input (cursor === length).
   */
  navigateDown(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor < this.entries.length) {
      this.cursor++;
    }
    if (this.cursor >= this.entries.length) return null; // back to live input
    return this.entries[this.cursor] ?? null;
  }

  /** Reset the cursor to "live input" (no history entry selected). */
  resetCursor(): void {
    this.cursor = this.entries.length;
  }

  /** Get a snapshot of all entries (oldest first, newest last). */
  getAll(): readonly string[] {
    return this.entries;
  }

  /** Get the number of entries. */
  size(): number {
    return this.entries.length;
  }

  /** Get the current cursor position. */
  getCursor(): number {
    return this.cursor;
  }

  /** Whether the cursor is at "live input" (not navigating history). */
  isLive(): boolean {
    return this.cursor >= this.entries.length;
  }

  /**
   * Clear all history (in-memory + on-disk).
   * Used by the Ctrl+L "clear input" shortcut (not implemented in this iter).
   */
  clear(): void {
    this.entries = [];
    this.cursor = 0;
    if (this.filePath !== null) {
      try {
        writeFileSync(this.filePath, '', 'utf-8');
      } catch {
        // Ignore write errors.
      }
    }
  }

  /**
   * T-075: Reverse-search through history entries.
   *
   * Searches for entries containing `query` as a substring (case-insensitive),
   * returning matches ordered most-recent-first. Returns an empty array if
   * `query` is empty or no entries match.
   *
   * Used by the Ctrl+R reverse-search UI in PromptInput.
   *
   * @param query The substring to search for.
   * @param startIndex Optional: only return entries at this index or older
   *                   (for "search next" — Ctrl+R again advances to the
   *                   next older match). Defaults to searching all entries.
   * @returns Array of matching entries, most-recent-first.
   */
  search(query: string, startIndex?: number): string[] {
    if (query.length === 0) return [];
    const lowerQuery = query.toLowerCase();
    const results: string[] = [];
    // Iterate from newest to oldest.
    const start = startIndex !== undefined
      ? Math.min(startIndex, this.entries.length - 1)
      : this.entries.length - 1;
    for (let i = start; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.toLowerCase().includes(lowerQuery)) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * T-075: Find the index of the next older match for `query` after `afterIndex`.
   *
   * Used to advance through matches when the user presses Ctrl+R repeatedly.
   * Returns -1 if no older match exists.
   *
   * @param query The substring to search for.
   * @param afterIndex The index after which to search (exclusive). Pass
   *                   `entries.length - 1` to start from the newest.
   * @returns The index of the next older match, or -1 if none.
   */
  searchNextIndex(query: string, afterIndex: number): number {
    if (query.length === 0) return -1;
    const lowerQuery = query.toLowerCase();
    const start = Math.min(afterIndex - 1, this.entries.length - 1);
    for (let i = start; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.toLowerCase().includes(lowerQuery)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Get the entry at a specific index (for use after searchNextIndex).
   * Returns null if the index is out of bounds.
   */
  getAt(index: number): string | null {
    return this.entries[index] ?? null;
  }
}
