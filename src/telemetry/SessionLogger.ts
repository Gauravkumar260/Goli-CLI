// src/telemetry/SessionLogger.ts
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface TurnRecord {
	event: string;
	turn?: number;
	tool?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheRead?: number;
	costUsd?: number;
	latencyMs?: number;
	success?: boolean;
	[key: string]: unknown;
}

export class SessionLogger {
	private db: Database;
	private sessionId: string;
	private lastChunks: unknown[] = [];

	constructor(sessionId: string) {
		this.sessionId = sessionId;
		const GOLI_CLI_HOME =
			process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");
		const dbPath = path.join(GOLI_CLI_HOME, "telemetry.sqlite");

		if (!fs.existsSync(GOLI_CLI_HOME)) {
			fs.mkdirSync(GOLI_CLI_HOME, { recursive: true });
		}

		this.db = new Database(dbPath);
		// V2 Robustness: Ensure schema matches expectations
		this.db.run(`
      CREATE TABLE IF NOT EXISTS turns (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        ts          TEXT    NOT NULL DEFAULT (datetime('now')),
        event_type  TEXT    NOT NULL,
        turn_num    INTEGER,
        tool_name   TEXT,
        input_toks  INTEGER,
        output_toks INTEGER,
        cache_read  INTEGER,
        cost_usd    REAL,
        latency_ms  INTEGER,
        success     INTEGER,
        extra       TEXT
      )
    `);
	}

	log(record: TurnRecord): void {
		try {
			const {
				event,
				turn,
				tool,
				inputTokens,
				outputTokens,
				cacheRead,
				costUsd,
				latencyMs,
				success,
				...extra
			} = record;
			// V2 Standard: Robust column mapping
			this.db
				.prepare(`
        INSERT INTO turns (session_id, event_type, turn_num, tool_name, input_toks, output_toks, cache_read, cost_usd, latency_ms, success, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
				.run(
					this.sessionId,
					event,
					turn ?? null,
					tool ?? null,
					inputTokens ?? null,
					outputTokens ?? null,
					cacheRead ?? null,
					costUsd ?? null,
					latencyMs ?? null,
					success === undefined ? null : success ? 1 : 0,
					Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
				);
		} catch (err: any) {
			if (
				err.message.includes("no such table") ||
				err.message.includes("no column named")
			) {
				this.db.run("DROP TABLE IF EXISTS turns");
				this.db.run(`
              CREATE TABLE IF NOT EXISTS turns (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT    NOT NULL,
                ts          TEXT    NOT NULL DEFAULT (datetime('now')),
                event_type  TEXT    NOT NULL,
                turn_num    INTEGER,
                tool_name   TEXT,
                input_toks  INTEGER,
                output_toks INTEGER,
                cache_read  INTEGER,
                cost_usd    REAL,
                latency_ms  INTEGER,
                success     INTEGER,
                extra       TEXT
              )
            `);
				// Attempt logging once more with fresh table
				try {
					this.log(record);
				} catch {}
			} else {
				console.error(`[SessionLogger] Failed to log turn: ${err.message}`);
			}
		}
	}

	setLastRetrievedChunks(chunks: unknown[]): void {
		this.lastChunks = chunks;
	}
	getLastRetrievedChunks(): unknown[] {
		return this.lastChunks;
	}

	close(): void {
		this.db.close();
	}

	static getRecentSessions(limit = 5): any[] {
		const GOLI_CLI_HOME =
			process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");
		const dbPath = path.join(GOLI_CLI_HOME, "telemetry.sqlite");
		try {
			const db = new Database(dbPath);
			const sessions = db
				.prepare(`
              SELECT session_id, MAX(ts) as last_active
              FROM turns
              GROUP BY session_id
              ORDER BY last_active DESC
              LIMIT ?
          `)
				.all(limit);
			db.close();
			return sessions;
		} catch {
			return [];
		}
	}
}
