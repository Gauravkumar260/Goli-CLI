/**
 * Trajectory store (Module 5, part 3).
 *
 * Logs every agent run as a structured JSONL trajectory. Provides
 * querying by outcome, task, date range, and token usage.
 *
 * ## Storage
 *
 * - **JSONL file**: `~/.agent/trajectories/trajectories.jsonl` —
 *   append-only, one JSON object per line.
 * - **SQLite index**: `~/.agent/trajectories/index.db` — fast queries
 *   by outcome, task, date, tokens.
 *
 * ## Why JSONL + SQLite?
 *
 * JSONL is human-readable and append-only (safe for concurrent writes).
 * SQLite provides indexed queries without loading the entire file.
 * Together they give us both durability and queryability.
 *
 * @module memory/trajectory/store
 */

import { appendFileSync, mkdirSync, existsSync, createReadStream, openSync, closeSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';

import Database from 'better-sqlite3';

import type { Trajectory, TrajectoryOutcome } from './types.js';
import type { Logger } from '@goli-cli/shared';

/** The TrajectoryStore — logs and queries agent run trajectories. */
export class TrajectoryStore {
  private readonly trajectoriesDir: string;
  private readonly jsonlPath: string;
  private readonly dbPath: string;
  private readonly db: Database.Database;
  private readonly log?: Logger;
  private readonly inMemory: boolean;

  constructor(opts: {
    trajectoriesDir?: string;
    inMemory?: boolean;
    logger?: Logger;
  } = {}) {
    this.inMemory = opts.inMemory ?? false;
    this.trajectoriesDir = opts.trajectoriesDir ?? join(homedir(), '.agent', 'trajectories');
    this.jsonlPath = join(this.trajectoriesDir, 'trajectories.jsonl');
    this.dbPath = join(this.trajectoriesDir, 'index.db');

    if (this.inMemory) {
      this.db = new Database(':memory:');
    } else {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
    }

    this.log = opts.logger;
    this.initSchema();
  }

  /** Initialize the SQLite index schema. */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trajectories (
        trajectory_id TEXT PRIMARY KEY,
        task_description TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        role TEXT NOT NULL,
        outcome TEXT NOT NULL,
        tests_passed INTEGER,
        step_count INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_cost_usd REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_root TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traj_outcome ON trajectories(outcome);
      CREATE INDEX IF NOT EXISTS idx_traj_task ON trajectories(task_description);
      CREATE INDEX IF NOT EXISTS idx_traj_timestamp ON trajectories(timestamp);
      CREATE INDEX IF NOT EXISTS idx_traj_tokens ON trajectories(total_tokens);
    `);
  }

  /**
   * Log a trajectory (append to JSONL + insert into SQLite index).
   *
   * Atomicity: the JSONL append and SQLite insert are NOT in a transaction.
   * If the SQLite insert fails (e.g. disk full), the JSONL has the trajectory
   * but the index doesn't — `getByOutcome` won't find it. We mitigate by
   * inserting into SQLite FIRST; if that succeeds, we append to JSONL.
   * If JSONL append fails, the SQLite row is orphaned but `getById` will
   * return null (acceptable — the caller can retry).
   * @param trajectory
   */
  append(trajectory: Trajectory): void {
    // Insert into SQLite index FIRST (so if JSONL fails, the index is consistent).
    this.db.prepare(`
      INSERT OR REPLACE INTO trajectories
        (trajectory_id, task_description, model, effort, role, outcome,
         tests_passed, step_count, total_tokens, total_cost_usd,
         duration_ms, timestamp, session_id, workspace_root)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trajectory.trajectoryId,
      trajectory.taskDescription,
      trajectory.model,
      trajectory.effort,
      trajectory.role,
      trajectory.outcome,
      trajectory.testsPassed ? 1 : 0,
      trajectory.steps.length,
      trajectory.totalTokens,
      trajectory.totalCostUsd,
      trajectory.durationMs,
      trajectory.timestamp,
      trajectory.sessionId,
      trajectory.workspaceRoot,
    );

    // Append to JSONL (after SQLite succeeds).
    if (!this.inMemory) {
      try {
        mkdirSync(dirname(this.jsonlPath), { recursive: true });
        appendFileSync(this.jsonlPath, JSON.stringify(trajectory) + '\n', 'utf-8');
      } catch (err) {
        this.log?.warn('Failed to append trajectory to JSONL', {
          id: trajectory.trajectoryId,
          error: err instanceof Error ? err.message : String(err),
        });
        // The SQLite row exists; `getById` will return null but `getByOutcome`
        // will still find the partial row. Acceptable degradation.
      }
    }

    this.log?.debug('Trajectory logged', {
      id: trajectory.trajectoryId,
      outcome: trajectory.outcome,
      steps: trajectory.steps.length,
      tokens: trajectory.totalTokens,
    });
  }

  /**
   * Get a trajectory by ID.
   *
   * The previous implementation read the ENTIRE JSONL file into memory
   * and parsed every line until it found the ID — O(N) per call, and
   * OOM for large files. We now:
   *   1. Check the SQLite index first (O(log N)). If the row doesn't
   *      exist, the trajectory was never logged — return null.
   *   2. If the row exists, scan the JSONL for the full trajectory.
   *      The scan is still O(N) but only happens for IDs that exist.
   *
   * For in-memory mode, we return null (the previous behavior was also
   * null, which silently broke the curator). We now log a warning so
   * the caller knows.
   * @param id
   */
  getById(id: string): Trajectory | null {
    if (this.inMemory) {
      this.log?.warn('TrajectoryStore.getById called in in-memory mode — returning null', { id });
      return null;
    }
    // Check the index first. If the row doesn't exist, don't scan JSONL.
    const row = this.db.prepare('SELECT trajectory_id FROM trajectories WHERE trajectory_id = ?').get(id);
    if (!row) return null;

    if (!existsSync(this.jsonlPath)) return null;

    // STREAM the JSONL line-by-line so we don't load the entire
    // file into memory. The previous implementation claimed "We
    // read line-by-line to avoid OOM on large files (readFileSync +
    // split would load everything)" — but the very next line did
    // EXACTLY that: `readFileSync(this.jsonlPath, 'utf-8')` then
    // `content.split('\n')`. For a store with 10,000 trajectories
    // averaging 50KB each (500MB JSONL), this was 500MB of heap +
    // 500MB array = 1GB peak. We now use `createReadStream` +
    // `readline.createInterface` for true line-by-line streaming.
    // NOTE: this method becomes async in the new API.
    return this.getByIdSync(id);
  }

  /** Synchronous streaming read — uses createReadStream with a
   * synchronous readline emulation. Returns null if not found.
   *
   * Since `getById` is currently sync, we use a chunked sync read:
   * read up to 4MB at a time, split on newlines, and search. This
   * bounds peak memory to ~4MB instead of the full file. */
  private getByIdSync(id: string): Trajectory | null {
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
    try {
      // Use a Buffer-based streaming read with chunked line assembly.
      const fd = openSync(this.jsonlPath, 'r');
      let leftover = '';
      const buf = Buffer.alloc(CHUNK_SIZE);
      try {
        while (true) {
          const bytesRead = readSync(fd, buf, 0, CHUNK_SIZE, null);
          if (bytesRead === 0) break;
          leftover += buf.subarray(0, bytesRead).toString('utf-8');
          const lines = leftover.split('\n');
          leftover = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const traj = JSON.parse(line) as Trajectory;
              if (traj.trajectoryId === id) return traj;
            } catch {
              // Skip malformed lines, but log so the corruption is visible.
              this.log?.warn('Malformed JSONL line in trajectory store', {
                linePreview: line.slice(0, 100),
              });
            }
          }
        }
        // Process the final leftover line.
        if (leftover.trim()) {
          try {
            const traj = JSON.parse(leftover) as Trajectory;
            if (traj.trajectoryId === id) return traj;
          } catch {
            this.log?.warn('Malformed JSONL line in trajectory store', {
              linePreview: leftover.slice(0, 100),
            });
          }
        }
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      this.log?.error('TrajectoryStore.getById read failed', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  /** Async streaming variant — preferred for new callers. */
  async getByIdAsync(id: string): Promise<Trajectory | null> {
    if (this.inMemory) return null;
    const row = this.db.prepare('SELECT trajectory_id FROM trajectories WHERE trajectory_id = ?').get(id);
    if (!row) return null;
    if (!existsSync(this.jsonlPath)) return null;
    try {
      const stream = createReadStream(this.jsonlPath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const traj = JSON.parse(line) as Trajectory;
          if (traj.trajectoryId === id) return traj;
        } catch {
          this.log?.warn('Malformed JSONL line in trajectory store', {
            linePreview: line.slice(0, 100),
          });
        }
      }
    } catch (err) {
      this.log?.error('TrajectoryStore.getByIdAsync read failed', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }

  /**
   * Query trajectories by outcome.
   * @param outcome
   * @param limit
   */
  getByOutcome(outcome: TrajectoryOutcome, limit: number = 100): Array<Partial<Trajectory>> {
    const rows = this.db.prepare(`
      SELECT * FROM trajectories WHERE outcome = ? ORDER BY timestamp DESC LIMIT ?
    `).all(outcome, limit) as TrajectoryRow[];
    return rows.map(this.rowToPartial);
  }

  /**
   * Query successful trajectories (for rejection sampling).
   * @param limit
   */
  getSuccessful(limit: number = 100): Array<Partial<Trajectory>> {
    return this.getByOutcome('success', limit);
  }

  /**
   * Query trajectories by task description (fuzzy match).
   * @param taskKeyword
   * @param limit
   */
  getByTask(taskKeyword: string, limit: number = 100): Array<Partial<Trajectory>> {
    const rows = this.db.prepare(`
      SELECT * FROM trajectories WHERE task_description LIKE ? ORDER BY timestamp DESC LIMIT ?
    `).all(`%${taskKeyword}%`, limit) as TrajectoryRow[];
    return rows.map(this.rowToPartial);
  }

  /**
   * Query trajectories by date range.
   * @param start
   * @param end
   * @param limit
   */
  getByDateRange(start: string, end: string, limit: number = 100): Array<Partial<Trajectory>> {
    const rows = this.db.prepare(`
      SELECT * FROM trajectories WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?
    `).all(start, end, limit) as TrajectoryRow[];
    return rows.map(this.rowToPartial);
  }

  /**
   * Get statistics about logged trajectories.
   */
  getStats(): {
    total: number;
    byOutcome: Record<string, number>;
    avgTokens: number;
    avgDurationMs: number;
    totalCostUsd: number;
  } {
    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM trajectories`).get() as { count: number };
    const outcomeRows = this.db.prepare(`
      SELECT outcome, COUNT(*) as count FROM trajectories GROUP BY outcome
    `).all() as Array<{ outcome: string; count: number }>;
    const avgRow = this.db.prepare(`
      SELECT AVG(total_tokens) as avg_tokens, AVG(duration_ms) as avg_duration, SUM(total_cost_usd) as total_cost
      FROM trajectories
    `).get() as { avg_tokens: number; avg_duration: number; total_cost: number };

    const byOutcome: Record<string, number> = {};
    for (const row of outcomeRows) {
      byOutcome[row.outcome] = row.count;
    }

    return {
      total: totalRow.count,
      byOutcome,
      avgTokens: Math.round(avgRow.avg_tokens ?? 0),
      avgDurationMs: Math.round(avgRow.avg_duration ?? 0),
      totalCostUsd: avgRow.total_cost ?? 0,
    };
  }

  /** Get the total trajectory count. */
  get count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM trajectories`).get() as { count: number };
    return row.count;
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }

  /**
   * Convert a DB row to a partial trajectory.
   * @param row
   */
  private rowToPartial(row: TrajectoryRow): Partial<Trajectory> {
    return {
      trajectoryId: row.trajectory_id,
      taskDescription: row.task_description,
      model: row.model,
      effort: row.effort,
      role: row.role,
      outcome: row.outcome as TrajectoryOutcome,
      testsPassed: row.tests_passed === 1,
      steps: [], // Not loaded from index — use getById for full trajectory
      totalTokens: row.total_tokens,
      totalCostUsd: row.total_cost_usd,
      durationMs: row.duration_ms,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      workspaceRoot: row.workspace_root,
    };
  }
}

/** Internal: the SQLite row shape. */
interface TrajectoryRow {
  trajectory_id: string;
  task_description: string;
  model: string;
  effort: string;
  role: string;
  outcome: string;
  tests_passed: number;
  step_count: number;
  total_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
  timestamp: string;
  session_id: string;
  workspace_root: string;
}
