import * as readline from "readline/promises";
import { AcceptanceSignal } from "../telemetry/AcceptanceSignal";
import { SessionLogger } from "../telemetry/SessionLogger";

export async function runFeedbackCommand() {
    const sessions = SessionLogger.getRecentSessions(5);
    if (sessions.length === 0) {
        console.log("No recent sessions found.");
        return;
    }

    console.log("\n💬 Goli-CLI Feedback");
    console.log("──────────────────────────────────────────────────────────");
    console.log("Recent Sessions:");
    sessions.forEach((s: any, i: number) => {
        console.log(`${i + 1}. ${s.session_id} (${s.last_active})`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const selection = await rl.question("\nSelect session index [1-5]: ");
    const idx = parseInt(selection) - 1;
    
    if (isNaN(idx) || idx < 0 || idx >= sessions.length) {
        console.log("Invalid selection.");
        rl.close();
        return;
    }

    const session = sessions[idx];
    const acceptance = await rl.question("Did the agent produce a useful diff? [y/n/partial]: ");
    const acc = acceptance.trim().toLowerCase();
    
    let accValue: 'yes' | 'no' | 'partial' = 'partial';
    if (acc === 'y' || acc === 'yes') accValue = 'yes';
    else if (acc === 'n' || acc === 'no') accValue = 'no';

    const comment = await rl.question("What didn't work? (optional): ");
    
    const signals = new AcceptanceSignal();
    signals.record({
        session_id: session.session_id,
        task_description: "Recent task", // We could pull this from turns table if needed
        acceptance: accValue,
        comment: comment,
        ts: new Date().toISOString()
    });
    signals.close();

    console.log("\n✅ Thank you! Feedback recorded locally.");
    rl.close();
}
