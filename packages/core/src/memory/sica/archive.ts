/**
 * SICA archive (Module 5, part 4).
 *
 * Append-only version history for every SICA change. Each entry records
 * the content at that version, the proposal that led to it, and whether
 * it was adopted or reverted. The archive enables rollback to any
 * prior version.
 *
 * @module memory/sica/archive
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { ArchiveEntry, SicaTarget } from './types.js';
import type { Logger } from '../../utils/logger.js';

/** Options for the SicaArchive. */
export interface SicaArchiveOptions {
  /** The archive file path (default: ~/.agent/sica/archive.jsonl). */
  archivePath?: string;
  /** Logger instance. */
  logger?: Logger;
}

/** The SICA archive — append-only version history. */
export class SicaArchive {
  private readonly archivePath: string;
  private readonly log?: Logger;

  constructor(opts: SicaArchiveOptions = {}) {
    this.archivePath = opts.archivePath ?? join(homedir(), '.agent', 'sica', 'archive.jsonl');
    this.log = opts.logger;
  }

  /**
   * Append an entry to the archive.
   * @param entry
   */
  append(entry: Omit<ArchiveEntry, 'entryId' | 'timestamp'>): ArchiveEntry {
    const fullEntry: ArchiveEntry = {
      ...entry,
      entryId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    mkdirSync(dirname(this.archivePath), { recursive: true });
    appendFileSync(this.archivePath, JSON.stringify(fullEntry) + '\n', 'utf-8');

    this.log?.debug('Archive entry appended', {
      entryId: fullEntry.entryId,
      version: fullEntry.version,
      target: fullEntry.target,
      status: fullEntry.status,
    });

    return fullEntry;
  }

  /**
   * Get the current version number for a target.
   * @param target
   * @param targetName
   */
  getCurrentVersion(target: SicaTarget, targetName: string): number {
    const entries = this.getHistory(target, targetName);
    return entries.length > 0 ? entries[entries.length - 1]!.version : 0;
  }

  /**
   * Get the full history for a target (chronological).
   * @param target
   * @param targetName
   */
  getHistory(target: SicaTarget, targetName: string): ArchiveEntry[] {
    return this.getAll()
      .filter((e) => e.target === target && e.targetName === targetName)
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Get all archive entries.
   */
  getAll(): ArchiveEntry[] {
    if (!existsSync(this.archivePath)) return [];
    const content = readFileSync(this.archivePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ArchiveEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is ArchiveEntry => e !== null);
  }

  /**
   * Get a specific version's content.
   * @param target
   * @param targetName
   * @param version
   */
  getVersion(target: SicaTarget, targetName: string, version: number): string | null {
    const history = this.getHistory(target, targetName);
    const entry = history.find((e) => e.version === version);
    return entry?.content ?? null;
  }

  /**
   * Get the content of the last adopted version.
   * @param target
   * @param targetName
   */
  getLastAdopted(target: SicaTarget, targetName: string): string | null {
    const history = this.getHistory(target, targetName);
    const adopted = [...history].reverse().find((e) => e.status === 'adopted' || e.status === 'initial');
    return adopted?.content ?? null;
  }

  /**
   * Get the total entry count.
   */
  get count(): number {
    return this.getAll().length;
  }
}
