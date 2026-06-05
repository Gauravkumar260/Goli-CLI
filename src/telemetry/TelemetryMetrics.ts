import { Database } from "bun:sqlite";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");

export interface OverviewStats {
	total_sessions: number;
	total_cost: number;
	avg_latency: number;
	completed: number;
	failed: number;
}

export interface ModelUsage {
	model: string;
	turns: number;
	cost: number;
	input_tokens: number;
	output_tokens: number;
}

export class TelemetryMetrics {
	private db: Database;

	constructor() {
		const dbPath = path.join(GOLI_CLI_HOME, "telemetry.sqlite");
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		this.db = new Database(dbPath);
	}

	getOverview(): OverviewStats {
		try {
			const stats = this.db
				.prepare(`
          SELECT 
            COUNT(DISTINCT session_id) as total_sessions,
            COALESCE(SUM(cost_usd), 0) as total_cost,
            COALESCE(AVG(latency_ms), 0) as avg_latency
          FROM turns
        `)
				.get() as any;

			const completion = this.db
				.prepare(`
          SELECT 
            COUNT(CASE WHEN event_type = 'stop' THEN 1 END) as completed,
            COUNT(CASE WHEN event_type = 'failure' THEN 1 END) as failed
          FROM turns
          WHERE event_type IN ('stop', 'failure')
        `)
				.get() as any;

			return {
				total_sessions: stats?.total_sessions ?? 0,
				total_cost: stats?.total_cost ?? 0,
				avg_latency: stats?.avg_latency ?? 0,
				completed: completion?.completed ?? 0,
				failed: completion?.failed ?? 0,
			};
		} catch (err) {
			console.error("Failed to get overview stats:", err);
			return {
				total_sessions: 0,
				total_cost: 0,
				avg_latency: 0,
				completed: 0,
				failed: 0,
			};
		}
	}

	getUsageByModel(): ModelUsage[] {
		try {
			return this.db
				.prepare(`
          SELECT 
            model,
            COUNT(*) as turns,
            COALESCE(SUM(cost_usd), 0) as cost,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens
          FROM turns
          WHERE model IS NOT NULL
          GROUP BY model
        `)
				.all() as ModelUsage[];
		} catch (err) {
			console.error("Failed to get model usage:", err);
			return [];
		}
	}

	getSessionEvents(sessionId: string): any[] {
		try {
			return this.db
				.prepare(`
          SELECT * FROM turns 
          WHERE session_id = ? 
          ORDER BY turn_number ASC, ts ASC
        `)
				.all(sessionId);
		} catch (err) {
			console.error(`Failed to get events for session ${sessionId}:`, err);
			return [];
		}
	}

	close(): void {
		try {
			this.db.close();
		} catch (err) {
			console.error("Error closing telemetry metrics database:", err);
		}
	}
}
