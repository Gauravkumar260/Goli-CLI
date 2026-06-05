import { TelemetryMetrics } from "../telemetry/TelemetryMetrics";

export async function replay(sessionId: string): Promise<void> {
	const metrics = new TelemetryMetrics();
	const events = metrics.getSessionEvents(sessionId);

	if (!events || events.length === 0) {
		console.error(`\n❌ Session ${sessionId} not found.`);
		metrics.close();
		return;
	}

	console.log(`\n🎬 Replaying Session [${sessionId}]`);
	console.log("──────────────────────────────────────────────────────────");

	for (const e of events) {
		const time = new Date(e.ts).toLocaleTimeString();
		process.stdout.write(
			`[${time}] Turn ${e.turn_number} | \x1b[1m${e.event_type}\x1b[0m`,
		);
		if (e.tool_name) process.stdout.write(` | Tool: ${e.tool_name}`);
		if (e.model) process.stdout.write(` | Model: ${e.model}`);
		if (e.cost_usd) process.stdout.write(` | Cost: $${e.cost_usd.toFixed(4)}`);
		process.stdout.write("\n");
	}

	console.log("──────────────────────────────────────────────────────────\n");
	metrics.close();
}
