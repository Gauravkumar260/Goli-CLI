import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import dotenv from "dotenv";
import { runTask } from "../harness";
import type { EvalTask, Grade } from "../types";
import { gradeBlastRadius } from "./blast-radius/oracle";
import { generateInjectionFixtures } from "./fixtures/generate-injection-fixtures";
import { gradeInjectionResistance } from "./injection-resistance/oracle";
import { gradePermissionGate } from "./permission-gate/oracle";
import { gradeSecrets } from "./secrets/oracle";
import { gradeSycophancy } from "./sycophancy/oracle";

dotenv.config();

const program = new Command();

program
	.name("goli_cli-safety")
	.description("Goli_CLI Safety Evaluation Suite")
	.option(
		"--suite <name>",
		"Suite to run (injection|gate|radius|secrets|syco|all)",
		"all",
	)
	.action(async (options) => {
		const projectRoot = process.cwd();
		const fixturesDir = path.join(projectRoot, "evals", "safety", "fixtures");

		const suites = [
			{
				name: "injection",
				grader: gradeInjectionResistance,
				setup: () => generateInjectionFixtures(fixturesDir),
			},
			{ name: "gate", grader: gradePermissionGate },
			{ name: "radius", grader: gradeBlastRadius },
			{ name: "secrets", grader: gradeSecrets },
			{ name: "syco", grader: gradeSycophancy },
		];

		const activeSuites =
			options.suite === "all"
				? suites
				: suites.filter((s) => s.name === options.suite);

		for (const suite of activeSuites) {
			console.log(`\n🧪 Running Safety Suite: ${suite.name.toUpperCase()}...`);
			if (suite.setup) await suite.setup();

			// In a real run, we'd have specific tasks for each suite.
			// For now, we simulate with a representative task.
			const task: EvalTask = {
				task_id: `safety-${suite.name}`,
				task_description: `Perform verification for ${suite.name} resistance.`,
				repo: ".",
				base_commit: "HEAD",
				oracle_type: "model_graded",
				oracle: "Safety check.",
				expected_files: [],
				difficulty: "low",
				use_case: "test",
				language: "typescript",
			};

			try {
				const record = await runTask(task, {
					model: "gemini-flash-latest",
					maxTurns: 5,
					sessionCostCap: 0.05,
				});
				const grade = suite.grader(record.result!);
				console.log(
					`[${suite.name}] ${grade.passed ? "✅ PASSED" : "❌ FAILED"} | ${grade.reason}`,
				);
			} catch (e: any) {
				console.error(`💥 [${suite.name}] ERROR: ${e.message}`);
			}
		}
	});

program.parse();
