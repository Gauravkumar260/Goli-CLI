// src/agent/doomLoop.ts
import { createHash } from "node:crypto";

interface TurnRecord {
	turn: number;
	tool: string;
	inputHash: string;
	input: Record<string, unknown>;
	errorHash?: string;
}

export interface DoomEvent {
	reason: "identical_tool_calls" | "read_edit_loop";
	tool: string;
	evidence: string;
}

export class DoomLoopDetector {
	private history: TurnRecord[] = [];

	constructor(
		private maxIdenticalCalls = 3,
		private windowSize = 8,
	) {}

	record(
		turn: number,
		tool: string,
		input: Record<string, unknown>,
		error?: string,
	): void {
		const inputHash = createHash("sha256")
			.update(JSON.stringify(input, Object.keys(input).sort()))
			.digest("hex")
			.slice(0, 16);

		const errorHash = error
			? createHash("sha256")
					.update(error.replace(/line \d+/g, "N").replace(/:\d+:\d+/g, ":N:N"))
					.digest("hex")
					.slice(0, 16)
			: undefined;

		// Root Fix: handle exactOptionalPropertyTypes
		this.history.push({
			turn,
			tool,
			inputHash,
			input,
			...(errorHash ? { errorHash } : {}),
		});

		if (this.history.length > this.windowSize) {
			this.history = this.history.slice(-this.windowSize);
		}
	}

	detect(): DoomEvent | null {
		const callCounts = new Map<string, number>();
		for (const r of this.history) {
			const key = `${r.tool}:${r.inputHash}`;
			callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
		}
		for (const [key, count] of callCounts) {
			if (count >= this.maxIdenticalCalls) {
				const [tool = "unknown"] = key.split(":");
				return {
					reason: "identical_tool_calls",
					tool,
					evidence: `"${tool}" called with identical inputs ${count}× in last ${this.history.length} turns`,
				};
			}
		}

		const recent = this.history.slice(-6);
		if (recent.length >= 4) {
			let failedEdits = 0;
			let lastReadFile = "";
			let alternating = true;

			for (let i = 0; i < recent.length; i++) {
				const r = recent[i]!;
				if (i % 2 === 0) {
					if (r.tool !== "read_file") {
						alternating = false;
						break;
					}
					const file = String((r.input as { path?: string }).path ?? "");
					if (i > 0 && file !== lastReadFile) {
						alternating = false;
						break;
					}
					lastReadFile = file;
				} else {
					if (r.tool !== "edit_file") {
						alternating = false;
						break;
					}
					if (r.errorHash) failedEdits++;
				}
			}

			if (alternating && failedEdits >= 2) {
				return {
					reason: "read_edit_loop",
					tool: "edit_file",
					evidence: `${failedEdits} failed edit_file attempts on "${lastReadFile}" — model is stuck`,
				};
			}
		}

		return null;
	}

	reset(): void {
		this.history = [];
	}
}
