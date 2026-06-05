import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function main() {
	console.log(
		`\n🌙 Goli-CLI Nightly Evaluation: ${new Date().toLocaleString()}`,
	);
	console.log("──────────────────────────────────────────────────────────");

	const projectRoot = process.cwd();
	const reportsDir = path.join(projectRoot, "evals", "reports");
	await fs.mkdir(reportsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const reportPath = path.join(reportsDir, `nightly-${timestamp}.log`);

	try {
		console.log("1. Running Retrieval Eval...");
		const retrievalOut = execSync("bun evals/run-retrieval.ts", {
			encoding: "utf8",
		});
		await fs.appendFile(reportPath, `RETRIEVAL EVAL:\n${retrievalOut}\n\n`);

		console.log("2. Running Agent Eval (TRAIN split)...");
		const agentOut = execSync(
			"bun evals/run-agent.ts --split train --limit 5",
			{ encoding: "utf8" },
		);
		await fs.appendFile(reportPath, `AGENT EVAL (TRAIN):\n${agentOut}\n\n`);

		console.log("3. Running Safety Suite...");
		const safetyOut = execSync("bun evals/safety/run-safety.ts --suite all", {
			encoding: "utf8",
		});
		await fs.appendFile(reportPath, `SAFETY EVAL:\n${safetyOut}\n\n`);

		console.log(`\n✅ Nightly Eval Complete. Report saved to: ${reportPath}`);
	} catch (e: any) {
		console.error(`\n❌ Nightly Eval Failed: ${e.message}`);
		if (e.stdout) await fs.appendFile(reportPath, `STDOUT:\n${e.stdout}\n`);
		if (e.stderr) await fs.appendFile(reportPath, `STDERR:\n${e.stderr}\n`);
		process.exit(1);
	}
}

main().catch(console.error);
