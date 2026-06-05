import { AuditLog } from "../safety/AuditLog.js";
import { TrajectoryAnalyzer } from "../telemetry/TrajectoryAnalyzer.js";

export async function evalStatus(): Promise<void> {
	const analyzer = new TrajectoryAnalyzer();
	const metrics = analyzer.getMetrics();
	const auditLog = new AuditLog();
	const audit = auditLog.verify();

	console.log("\n📊 Goli-CLI Evaluation & Trajectory Report");
	console.log("──────────────────────────────────────────────────────────");

	console.log("Operational Metrics:");
	console.log(`- Total Sessions:    ${metrics.totalSessions}`);
	console.log(`- Success Rate:      ${(metrics.successRate * 100).toFixed(1)}%`);
	console.log(`- Avg Turns/Success: ${metrics.avgTurnsToSuccess.toFixed(1)}`);
	console.log(`- Avg Cost/Session:  $${metrics.avgCostPerSession.toFixed(4)}`);
	console.log(`- Avg Latency:       ${(metrics.avgLatencyMs / 1000).toFixed(1)}s`);

	console.log("\nTop Failure Patterns:");
	if (metrics.topFailurePatterns.length === 0) {
		console.log("- No failures recorded.");
	} else {
		for (const p of metrics.topFailurePatterns) {
			if (p.count > 0) {
				console.log(
					`- ${p.pattern.padEnd(16)} ${p.count} sessions (${(p.percentage * 100).toFixed(1)}%)`,
				);
			}
		}
	}

	console.log("\nAudit Health:");
	if (audit.valid) {
		console.log("- Integrity:       \x1b[32m✅ VALID\x1b[0m");
	} else {
		console.log("- Integrity:       \x1b[31m❌ BROKEN\x1b[0m");
	}

	console.log("──────────────────────────────────────────────────────────\n");

	analyzer.close();
}
