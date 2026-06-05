import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runTask } from "../../evals/harness.js";
import type { EvalTask } from "../../evals/types.js";

export async function captureTask(options: {
	task: string;
	repo?: string;
}): Promise<void> {
	const projectRoot = options.repo || process.cwd();
	const taskId = `task-${Date.now().toString().slice(-6)}`;

	console.log(`\n📸 Capturing eval task: ${taskId}`);

	// 1. Get current commit as base
	const baseCommit = execSync("git rev-parse HEAD", {
		cwd: projectRoot,
		encoding: "utf8",
	}).trim();

	// 2. Get staged changes as gold standard (oracle)
	const diff = execSync("git diff --cached", {
		cwd: projectRoot,
		encoding: "utf8",
	}).trim();

	if (!diff) {
		console.warn("⚠️ No staged changes found. Task will have no oracle diff.");
	}

	const task: EvalTask = {
		task_id: taskId,
		task_description: options.task,
		repo: projectRoot,
		base_commit: baseCommit,
		oracle_type: "diff_match",
		oracle: diff,
		expected_files: [], // Could be parsed from diff
		difficulty: "medium",
		use_case: "implement",
		language: "typescript",
	};

	const outDir = path.join(projectRoot, "evals", "community");
	await fs.mkdir(outDir, { recursive: true });
	const outPath = path.join(outDir, `${taskId}.json`);

	await fs.writeFile(outPath, JSON.stringify(task, null, 2), "utf8");
	console.log(`✅ Task captured to ${outPath}`);
}

export async function verifyTask(taskPath: string): Promise<void> {
	const absolutePath = path.resolve(taskPath);
	console.log(`\n🧪 Verifying eval task: ${taskPath}`);

	if (!(await fs.stat(absolutePath).catch(() => null))) {
		throw new Error(`Task file not found: ${taskPath}`);
	}

	const task = JSON.parse(await fs.readFile(absolutePath, "utf8")) as EvalTask;

	const result = await runTask(task, {
		model: "gemini/gemini-2.0-flash",
		maxTurns: 15,
		sessionCostCap: 0.1,
	});

	console.log("\n──────────────────────────────────────────────────────────");
	console.log(`Result: ${result.grade.passed ? "✅ PASSED" : "❌ FAILED"}`);
	console.log(`Score:  ${result.grade.score.toFixed(2)}`);
	console.log(`Reason: ${result.grade.reason}`);
	console.log("──────────────────────────────────────────────────────────\n");
}
