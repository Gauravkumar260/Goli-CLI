import { Database } from "bun:sqlite";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");

export interface FailurePattern {
	pattern:
		| "doom_loop"
		| "context_overflow"
		| "bad_retrieval"
		| "tests_failed"
		| "unknown";
	count: number;
	percentage: number;
}

export interface TrajectoryMetrics {
	totalSessions: number;
	successRate: number;
	avgTurnsToSuccess: number;
	avgCostPerSession: number;
	avgLatencyMs: number;
	safetyFiringRate: number;
	topFailurePatterns: FailurePattern[];
}

export class TrajectoryAnalyzer {
	private db: Database;

	constructor() {
		const dbPath = path.join(GOLI_CLI_HOME, "telemetry.sqlite");
		if (!fs.existsSync(GOLI_CLI_HOME)) {
			fs.mkdirSync(GOLI_CLI_HOME, { recursive: true });
		}
		this.db = new Database(dbPath);
	}

	getMetrics(): TrajectoryMetrics {
		try {
			const totalSessions = this.countSessions();
			const successSessions = this.countSuccessfulSessions();
			const failedSessions = totalSessions - successSessions;

			const patterns = this.analyzeFailurePatterns(failedSessions);

			return {
				totalSessions,
				successRate: totalSessions > 0 ? successSessions / totalSessions : 0,
				avgTurnsToSuccess: this.getAverageTurns(),
				avgCostPerSession: this.getAverageCost(),
				avgLatencyMs: this.getAverageLatency(),
				safetyFiringRate: this.getSafetyFiringRate(),
				topFailurePatterns: patterns,
			};
		} catch (err) {
			console.error("Failed to compute trajectory metrics:", err);
			return {
				totalSessions: 0,
				successRate: 0,
				avgTurnsToSuccess: 0,
				avgCostPerSession: 0,
				avgLatencyMs: 0,
				safetyFiringRate: 0,
				topFailurePatterns: [],
			};
		}
	}

	private countSessions(): number {
		const row = this.db
			.prepare("SELECT COUNT(DISTINCT session_id) as count FROM turns")
			.get() as any;
		return row?.count ?? 0;
	}

	private countSuccessfulSessions(): number {
		// In V2, we track success in session_end events
		const row = this.db
			.prepare(`
			SELECT COUNT(DISTINCT session_id) as count 
			FROM turns 
			WHERE event_type = 'session_end' AND success = 1
		`)
			.get() as any;
		return row?.count ?? 0;
	}

	private analyzeFailurePatterns(totalFailed: number): FailurePattern[] {
		if (totalFailed === 0) return [];

		const patterns: Record<string, number> = {
			doom_loop: 0,
			context_overflow: 0,
			bad_retrieval: 0,
			tests_failed: 0,
		};

		// 1. Detect Doom Loops
		// Cluster sessions where we see more than 3 'doom_loop' events or identical tool calls
		const doomLoops = this.db
			.prepare(`
			SELECT COUNT(DISTINCT session_id) as count 
			FROM turns 
			WHERE event_type = 'doom_loop'
		`)
			.get() as any;
		patterns.doom_loop = doomLoops?.count ?? 0;

		// 2. Detect Context Overflow
		// (Approximate via max turns hit or large input tokens)
		const overflows = this.db
			.prepare(`
			SELECT COUNT(DISTINCT session_id) as count 
			FROM turns 
			WHERE event_type = 'session_end' AND reason = 'limit_reached'
		`)
			.get() as any;
		patterns.context_overflow = overflows?.count ?? 0;

		// 3. Tests Failed
		const testFailures = this.db
			.prepare(`
			SELECT COUNT(DISTINCT session_id) as count 
			FROM turns 
			WHERE tool_name = 'run_tests' AND success = 0
		`)
			.get() as any;
		patterns.tests_failed = testFailures?.count ?? 0;

		return Object.entries(patterns)
			.map(([pattern, count]) => ({
				pattern: pattern as any,
				count,
				percentage: count / totalFailed,
			}))
			.sort((a, b) => b.count - a.count);
	}

	private getAverageTurns(): number {
		const row = this.db
			.prepare(
				"SELECT AVG(turn_num) as avg FROM turns WHERE event_type = 'session_end'",
			)
			.get() as any;
		return row?.avg ?? 0;
	}

	private getAverageCost(): number {
		const row = this.db
			.prepare(
				"SELECT AVG(cost_usd) as avg FROM turns WHERE event_type = 'session_end'",
			)
			.get() as any;
		return row?.avg ?? 0;
	}

	private getAverageLatency(): number {
		const row = this.db
			.prepare("SELECT AVG(latency_ms) as avg FROM turns WHERE latency_ms > 0")
			.get() as any;
		return row?.avg ?? 0;
	}

	private getSafetyFiringRate(): number {
		const total = this.db
			.prepare("SELECT COUNT(*) as count FROM turns")
			.get() as any;
		const safety = this.db
			.prepare(
				"SELECT COUNT(*) as count FROM turns WHERE event_type = 'gate_deny'",
			)
			.get() as any;
		if (!total || total.count === 0) return 0;
		return (safety?.count ?? 0) / total.count;
	}

	close(): void {
		this.db.close();
	}
}
