import type { ModelProvider } from "../src/providers/ModelProvider";
import type { EvalRecord, EvalTask } from "./types";

export type FailureClass =
	| "bad_retrieval"
	| "wrong_tool"
	| "hallucinated_code"
	| "context_overflow"
	| "bad_plan"
	| "injection"
	| "blast_radius_limit"
	| "test_runner_error"
	| "other";

const FAILURE_CLASSIFIER_PROMPT = `You are analyzing a failed AI coding agent session.

TASK: "{task_description}"
FINAL MESSAGE: "{final_message}"
LAST TURN ACTIONS:
{last_turns}

Classify the primary failure reason. Choose exactly one:
bad_retrieval | wrong_tool | hallucinated_code | context_overflow | bad_plan | injection | blast_radius_limit | test_runner_error | other

Respond ONLY with valid JSON:
{
  "failure_class": "...",
  "confidence": 0.0-1.0,
  "evidence": "one sentence citing specific evidence"
}`;

export class FailureAnalysis {
	constructor(private model: ModelProvider) {}

	async analyze(
		task: EvalTask,
		record: EvalRecord,
	): Promise<{ failure_class: FailureClass; evidence: string }> {
		const lastTurns =
			record.result?.context?.messages
				.slice(-6)
				.map(
					(m: any) => `Role: ${m.role}, Content: ${m.content.substring(0, 200)}...`,
				)
				.join("\n") || "No turn history available";

		const prompt = FAILURE_CLASSIFIER_PROMPT.replace(
			"{task_description}",
			task.task_description,
		)
			.replace(
				"{final_message}",
				record.result?.answer || record.result?.reason || "Unknown error",
			)
			.replace("{last_turns}", lastTurns);

		try {
			const response = await this.model.complete(
				[{ role: "user", content: prompt }],
				"You are a failure analyst. Respond only with valid JSON.",
			);

			const jsonMatch = response.text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error("Invalid analysis response");

			return JSON.parse(jsonMatch[0]);
		} catch (e: any) {
			return {
				failure_class: "other",
				evidence: `Analysis failed: ${e.message}`,
			};
		}
	}
}

