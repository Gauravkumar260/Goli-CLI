import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

export interface TrainingExample {
	example_id: string;
	task: string;
	repo_language: string;
	context_chunks: string[];
	diff: string;
	turns: number;
	model: string;
	ts: string;
	accepted: boolean;
	edit_distance: number;
}

export async function collectTrainingExample(
	meta: {
		task: string;
		language: string;
		retrievedChunks?: Array<{ text: string }>;
		turns: number;
		model: string;
		costUsd: number;
	},
	diff: string,
	accepted: boolean,
): Promise<void> {
	// Only collect accepted examples with reasonable cost
	if (!accepted) return;
	if (meta.costUsd > 0.15) return;

	const example: TrainingExample = {
		example_id: randomUUID(),
		task: meta.task,
		repo_language: meta.language,
		context_chunks: (meta.retrievedChunks || []).map((c) => c.text),
		diff: diff || "",
		turns: meta.turns,
		model: meta.model,
		ts: new Date().toISOString(),
		accepted: true,
		edit_distance: 0,
	};

	const month = new Date().toISOString().slice(0, 7);
	const outDir = join(os.homedir(), ".goli_cli", "training-data");
	const outPath = join(outDir, `${month}.jsonl`);

	try {
		if (!fs.existsSync(outDir)) {
			await fsPromises.mkdir(outDir, { recursive: true });
		}
		await fsPromises.appendFile(
			outPath,
			`${JSON.stringify(example)}\n`,
			"utf8",
		);
	} catch (err) {
		console.error("Failed to collect training example:", err);
	}
}
