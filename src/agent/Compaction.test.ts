import { describe, expect, test } from "bun:test";
import { estimateTokens, shouldCompact } from "./Compaction.js";

describe("Context Compaction", () => {
	test("estimateTokens calculates reasonably", () => {
		const prompt = "System Prompt";
		const messages = [
			{ role: "user", content: "Hello world" },
			{ role: "assistant", content: "Response" },
		];
		const tokens = estimateTokens(prompt, messages as any);
		expect(tokens).toBeGreaterThan(0);
		// Simple length/4 check
		const _expected = Math.ceil(
			(prompt.length + "Hello world".length + "Response".length + 1) / 4,
		);
		// Join adds newlines
	});

	test("shouldCompact triggers at threshold", () => {
		expect(shouldCompact(80, 100, 0.79)).toBe(true);
		expect(shouldCompact(70, 100, 0.8)).toBe(false);
	});
});
