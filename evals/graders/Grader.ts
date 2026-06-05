import type { EvalTask, Grade } from "../types.js";
import type { AgentResult } from "../../src/agent/AgentLoop.js";
import type { Sandbox } from "../../src/sandbox/Sandbox.js";
import { ModelGrader } from "./ModelGrader.js";
import type { ModelProvider } from "../../src/providers/ModelProvider.js";

export class Grader {
	private modelGrader: ModelGrader | null = null;

	constructor(graderModel?: ModelProvider) {
		if (graderModel) {
			this.modelGrader = new ModelGrader(graderModel);
		}
	}

	async grade(
		task: EvalTask,
		result: AgentResult,
		sandbox: Sandbox,
	): Promise<Grade> {
		// 1. Oracle Grader (Test Suite)
		if (task.oracle_type === "test_suite") {
			const output = await sandbox.execute(task.oracle);
			const passed = !output.toLowerCase().includes("failed");
			return {
				passed,
				score: passed ? 1.0 : 0.0,
				reason: passed ? "Test suite passed" : "Test suite failed",
				details: { output },
			};
		}

		// 2. Model Grader
		if (task.oracle_type === "model_graded") {
			if (!this.modelGrader) {
				return {
					passed: false,
					score: 0,
					reason: "Model grader requested but no grader model provided",
				};
			}
			return this.modelGrader.grade(task, result);
		}

		// 3. Regex / Diff Match
		if (task.oracle_type === "diff_match") {
			const actualDiff = (result as any).diff || "";
			const expectedDiff = task.oracle;
			// Simple check: does the gold standard diff fragment exist in actual?
			const passed = actualDiff.includes(expectedDiff.trim());
			return {
				passed,
				score: passed ? 1.0 : 0.0,
				reason: passed ? "Diff fragment matched" : "Diff mismatch",
			};
		}

		// Default: status-based
		const passed = result.status === "done";
		return {
			passed,
			score: passed ? 1.0 : 0,
			reason: passed ? "Agent reported success" : "Agent failed",
		};
	}
}
