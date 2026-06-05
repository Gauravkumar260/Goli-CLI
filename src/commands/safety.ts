import { AuditLog } from "../safety/AuditLog.js";
import { TelemetryMetrics } from "../telemetry/TelemetryMetrics.js";

export async function safetyStatus(): Promise<void> {
	const metrics = new TelemetryMetrics();
	const overview = metrics.getOverview();

	const auditLog = new AuditLog();
	const audit = auditLog.verify();

	console.log("\n🔐 Goli-CLI Safety Dashboard");
	console.log("──────────────────────────────────────────────────────────");

	console.log("Action Overview:");
	console.log(`- Total Sessions:    ${overview.total_sessions ?? 0}`);

	console.log("\nAudit Health:");
	if (audit.valid) {
		console.log("- Integrity:       \x1b[32m✅ VALID\x1b[0m");
		console.log(`- Entries:         ${audit.count}`);
	} else {
		console.log("- Integrity:       \x1b[31m❌ BROKEN\x1b[0m");
		// @ts-expect-error
		if (audit.error) console.log(`- Error:           ${audit.error}`);
	}

	const _usage = metrics.getUsageByModel();
	console.log("\nCost Profile:");
	console.log(
		`- Total Project Cost: $${(overview.total_cost ?? 0).toFixed(4)}`,
	);

	console.log("──────────────────────────────────────────────────────────\n");

	metrics.close();
}
