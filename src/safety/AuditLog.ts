import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

export interface AuditEntry {
	id?: number;
	session_id: string;
	ts: string;
	event: string;
	tool?: string;
	payload_hash?: string;
	decision: string;
	latency_ms: number;
	entry_hash: string;
}

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(homedir(), ".goli_cli");

export class AuditLog {
	private db: Database;
	private prevHash = "0".repeat(64);

	constructor() {
		if (!fs.existsSync(GOLI_CLI_HOME)) {
			fs.mkdirSync(GOLI_CLI_HOME, { recursive: true });
		}
		const dbPath = path.join(GOLI_CLI_HOME, "audit.sqlite");
		this.db = new Database(dbPath);

		this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT    NOT NULL,
        ts           TEXT    NOT NULL DEFAULT (datetime('now')),
        event        TEXT    NOT NULL,
        tool         TEXT,
        payload_hash TEXT,
        decision     TEXT    NOT NULL,
        latency_ms   INTEGER NOT NULL,
        entry_hash   TEXT    NOT NULL
      )
    `);

		const row = this.db
			.query("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1")
			.get() as { entry_hash?: string } | undefined;
		if (row?.entry_hash) {
			this.prevHash = row.entry_hash;
		}
	}

	async log(
		sessionId: string,
		event: string,
		tool: string | undefined,
		payload: any,
		decision: string,
		latencyMs: number,
	): Promise<void> {
		const payloadHash = payload
			? createHash("sha256").update(JSON.stringify(payload)).digest("hex")
			: null;

		const ts = new Date().toISOString();
		const entryBase = {
			session_id: sessionId,
			event,
			tool,
			payload_hash: payloadHash,
			decision,
		};

		const entryHash = createHash("sha256")
			.update(this.prevHash + JSON.stringify(entryBase))
			.digest("hex");

		this.db
			.prepare(
				`
      INSERT INTO audit_log (session_id, ts, event, tool, payload_hash, decision, latency_ms, entry_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				sessionId,
				ts,
				event,
				tool ?? null,
				payloadHash,
				decision,
				latencyMs,
				entryHash,
			);

		this.prevHash = entryHash;
	}

	verify(): { valid: boolean; brokenAt?: number; count: number } {
		const rows = this.db
			.query("SELECT * FROM audit_log ORDER BY id ASC")
			.all() as any[];
		let expectedPrevHash = "0".repeat(64);

		for (const row of rows) {
			const entryBase = {
				session_id: row.session_id,
				event: row.event,
				tool: row.tool,
				payload_hash: row.payload_hash,
				decision: row.decision,
			};

			const actualHash = createHash("sha256")
				.update(expectedPrevHash + JSON.stringify(entryBase))
				.digest("hex");

			if (row.entry_hash !== actualHash) {
				return { valid: false, brokenAt: row.id, count: rows.length };
			}
			expectedPrevHash = row.entry_hash;
		}

		return { valid: true, count: rows.length };
	}

	close(): void {
		this.db.close();
	}
}
