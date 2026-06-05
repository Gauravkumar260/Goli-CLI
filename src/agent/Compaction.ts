// src/agent/compaction.ts
import type { ModelProvider } from "../providers/ModelProvider.js";

type Msg = { role: "user" | "assistant" | "tool" | "system"; content: string };

export function estimateTokens(systemPrompt: string, messages: Msg[]): number {
	const allText = systemPrompt + messages.map((m) => m.content).join("\n");
	return Math.ceil(allText.length / 4);
}

export function shouldCompact(
	currentTokens: number,
	windowTokens: number,
	threshold = 0.8,
): boolean {
	return currentTokens / windowTokens > threshold;
}

export async function compactContext(
	messages: Msg[],
	_systemPrompt: string,
	compactModel: ModelProvider,
): Promise<{ messages: Msg[] }> {
	if (messages.length <= 4) return { messages };

	const firstUserMsg = messages.find((m) => m.role === "user");
	const recentMessages = messages.slice(-3);

	const toCompress = messages.slice(1, -3);
	if (toCompress.length === 0) return { messages };

	const compressionPrompt = `Summarize the following agent session history in 300 words or less.
Preserve: what files were read, what changes were made (as a brief diff description),
what tests passed or failed, and what the current working state is.
Do NOT invent information not present in the history.

Session history:
${toCompress.map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`).join("\n\n")}`;

	const summary = await compactModel.complete(
		[{ role: "user", content: compressionPrompt }],
		"You are a session summarizer. Be precise and brief.",
	);

	const compressedMsg: Msg = {
		role: "tool",
		content: `[SESSION SUMMARY — ${toCompress.length} turns compressed]\n${summary}`,
	};

	return {
		messages: [
			...(firstUserMsg ? [firstUserMsg] : []),
			compressedMsg,
			...recentMessages,
		],
	};
}
