import { Database } from "bun:sqlite";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");

export interface AcceptanceRecord {
	session_id: string;
	task_description: string;
	acceptance: "yes" | "no" | "partial";
	comment?: string;
	ts: string;
}

export class AcceptanceSignal {
	private db: Database;

	constructor() {
		const dbPath = path.join(GOLI_CLI_HOME, "telemetry.sqlite");
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		this.db = new Database(dbPath);
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS acceptance (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT    NOT NULL,
        task_description TEXT,
        acceptance      TEXT    NOT NULL,
        comment         TEXT,
        ts              TEXT    NOT NULL
      );
    `);
	}

	record(record: AcceptanceRecord): void {
		try {
			const query = this.db.prepare(`
        INSERT INTO acceptance (session_id, task_description, acceptance, comment, ts)
        VALUES (?, ?, ?, ?, ?)
      `);
			query.run(
				record.session_id,
				record.task_description,
				record.acceptance,
				record.comment || null,
				record.ts,
			);
		} catch (err) {
			console.error("Failed to record acceptance signal:", err);
		}
	}

	getStats(): { total: number; accepted: number; rejected: number } {
		try {
			const result = this.db
				.prepare(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN acceptance = 'yes' THEN 1 END) as accepted,
            COUNT(CASE WHEN acceptance = 'no' THEN 1 END) as rejected
          FROM acceptance
        `)
				.get() as any;
			return {
				total: result?.total ?? 0,
				accepted: result?.accepted ?? 0,
				rejected: result?.rejected ?? 0,
			};
		} catch (err) {
			console.error("Failed to get acceptance stats:", err);
			return { total: 0, accepted: 0, rejected: 0 };
		}
	}

	close(): void {
		try {
			this.db.close();
		} catch (err) {
			console.error("Error closing acceptance database:", err);
		}
	}
}
