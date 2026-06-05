import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { TrajectoryAnalyzer } from "../telemetry/TrajectoryAnalyzer";

const GOLI_CLI_HOME =
	process.env.GOLI_CLI_HOME || path.join(os.homedir(), ".goli_cli");

export async function checkMaturity(): Promise<void> {
	const analyzer = new TrajectoryAnalyzer();
	const metrics = analyzer.getMetrics();

	console.log("\n📈 Goli-CLI Maturity Report: Road to Level 2");
	console.log("──────────────────────────────────────────────────────────");

	// 1. Prompt Optimization (>= 6 iterations)
	let iterations = 0;
	try {
		const logPath = path.join(process.cwd(), "docs", "prompt-iterations.md");
		const content = await fs.readFile(logPath, "utf-8");
		iterations = (content.match(/^\| 20/gm) || []).length;
	} catch {
		// ignore
	}
	const iterStatus = iterations >= 6 ? "✅" : "🚧";
	console.log(
		`- Prompt Optimization:   ${iterStatus} ${iterations}/6 iterations`,
	);

	// 2. Golden Set (>= 150 tasks)
	let taskCount = 0;
	try {
		const v1Dir = path.join(process.cwd(), "evals", "golden-set", "v1");
		const v2Dir = path.join(process.cwd(), "evals", "golden-set", "v2");
		const v1 = await fs.readdir(v1Dir).catch(() => []);
		const v2 = await fs.readdir(v2Dir).catch(() => []);
		taskCount = v1.length + v2.length;
	} catch {
		// ignore
	}
	const taskStatus = taskCount >= 150 ? "✅" : "🚧";
	console.log(`- Golden Set Size:       ${taskStatus} ${taskCount}/150 tasks`);

	// 3. Training Data (>= 500 examples)
	let examples = 0;
	try {
		const dataDir = path.join(GOLI_CLI_HOME, "training-data");
		const files = await fs.readdir(dataDir);
		for (const file of files) {
			const content = await fs.readFile(path.join(dataDir, file), "utf-8");
			examples += content
				.trim()
				.split("\n")
				.filter((l) => l).length;
		}
	} catch {
		// ignore
	}
	const exampleStatus = examples >= 500 ? "✅" : "🚧";
	console.log(
		`- Training Examples:     ${exampleStatus} ${examples}/500 collected`,
	);

	// 4. pass@1 (> 70%)
	const passRate = metrics.successRate * 100;
	const passStatus = passRate >= 70 ? "✅" : "🚧";
	console.log(
		`- pass@1 Success Rate:   ${passStatus} ${passRate.toFixed(1)}% (Target: >70%)`,
	);

	console.log("──────────────────────────────────────────────────────────");

	const totalProgress =
		((Math.min(iterations, 6) / 6 +
			Math.min(taskCount, 150) / 150 +
			Math.min(examples, 500) / 500 +
			Math.min(passRate, 70) / 70) /
			4) *
		100;

	console.log(`Overall Level 2 Progress: ${totalProgress.toFixed(1)}%`);

	if (totalProgress >= 100) {
		console.log("\n🏆 CONGRATULATIONS: Maturity Level 2 Achieved!");
	} else {
		console.log(
			"\n💡 Next step: Run 'goli eval' more often to accumulate data.",
		);
	}
	console.log("──────────────────────────────────────────────────────────\n");

	analyzer.close();
}
