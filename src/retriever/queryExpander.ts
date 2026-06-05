// src/retriever/queryExpander.ts
import type { ModelProvider } from "../providers/ModelProvider.js";

export async function expandQuery(
	task: string,
	model: ModelProvider,
): Promise<string> {
	if (task.split(" ").length <= 3) return task;

	const prompt = `Extract 5-8 specific technical terms for code search from this task.
Output ONLY a JSON array of strings. No explanation, no markdown, no code blocks.
Examples:
"fix auth bug" → ["authenticate","AuthError","verifyToken","loginHandler","jwt","session"]
"add rate limiting" → ["rateLimit","middleware","throttle","RateLimiter","429","express-rate-limit"]
"refactor database layer" → ["repository","DataSource","QueryBuilder","ORM","connection","pool"]

Task: "${task.slice(0, 200)}"`;

	try {
		const response = await model.complete(
			[{ role: "user", content: prompt }],
			"You are a technical term extractor for code search.",
		);

		const text = response.text.trim();

		const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
		const terms = JSON.parse(cleaned) as string[];

		if (!Array.isArray(terms) || terms.length === 0) return task;

		const symbolTerms = terms.filter((t) => /[A-Z]/.test(t) || t.includes("_"));
		const allTerms = [...terms, ...symbolTerms];

		return `${task} ${allTerms.join(" ")}`;
	} catch {
		return task;
	}
}

