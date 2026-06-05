import * as readline from "node:readline/promises";
import { AcceptanceSignal } from "../telemetry/AcceptanceSignal";
import { SessionLogger } from "../telemetry/SessionLogger";

interface RecentSession {
	session_id: string;
	last_active: string;
}

export async function runFeedbackCommand(): Promise<void> {
	const sessions = SessionLogger.getRecentSessions(5) as RecentSession[];
	if (sessions.length === 0) {
		console.log("No recent sessions found.");
		return;
	}

	console.log("\n💬 Goli-CLI Feedback");
	console.log("──────────────────────────────────────────────────────────");
	console.log("Recent Sessions:");
	sessions.forEach((s, i) => {
		console.log(`${i + 1}. ${s.session_id} (${s.last_active})`);
	});

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const selection = await rl.question("\nSelect session index [1-5]: ");
	const idx = Number.parseInt(selection, 10) - 1;

	if (Number.isNaN(idx) || idx < 0 || idx >= sessions.length) {
		console.log("Invalid selection.");
		rl.close();
		return;
	}

	const session = sessions[idx];
	if (!session) {
		console.log("Invalid selection.");
		rl.close();
		return;
	}

	const acceptanceRaw = await rl.question(
		"Did the agent produce a useful diff? [y/n/partial]: ",
	);
	const acceptance = acceptanceRaw.trim().toLowerCase();

	let accValue: "yes" | "no" | "partial" = "partial";
	if (acceptance === "y" || acceptance === "yes") accValue = "yes";
	else if (acceptance === "n" || acceptance === "no") accValue = "no";

	const comment = await rl.question("What didn't work? (optional): ");
	rl.close();

	const signals = new AcceptanceSignal();
	// Root Fix: Avoid passing undefined and ensure session_id exists
	signals.record({
		session_id: session.session_id,
		task_description: "Recent task",
		acceptance: accValue,
		...(comment ? { comment } : {}),
		ts: new Date().toISOString(),
	});
	signals.close();

	console.log("\n✅ Thank you! Feedback recorded locally.");
}
