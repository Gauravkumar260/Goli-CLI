// src/providers/router.ts
import { ClaudeProvider } from "./ClaudeProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";
import type { ModelProvider } from "./ModelProvider.js";
import { OllamaCloudProvider } from "./OllamaCloudProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";

export type ModelSpec = string; // e.g., "gemini/gemini-2.0-flash"

export function createProvider(spec: ModelSpec): ModelProvider {
	const [providerName, ...modelParts] = spec.split("/");
	const modelId = modelParts.join("/");

	switch (providerName) {
		case "gemini":
			return new GeminiProvider(
				process.env.GEMINI_API_KEY || "",
				modelId || "gemini-2.0-flash",
			);
		case "anthropic":
		case "claude":
			return new ClaudeProvider(
				process.env.ANTHROPIC_API_KEY || "",
				modelId || "claude-3-5-sonnet-latest",
			);
		case "ollama-cloud":
			return new OllamaCloudProvider(
				process.env.OLLAMA_API_KEY || "",
				modelId || "gpt-oss:120b",
			);
		case "ollama":
			return new OllamaProvider(modelId || "qwen2.5-coder:7b");
		default:
			throw new Error(`Unknown provider "${providerName}".`);
	}
}

export function selectModelTier(
	_task: string,
	_contextTokens: number,
	_sessionCostSoFar: number,
	forcedSpec?: ModelSpec,
): ModelSpec {
	if (forcedSpec) return forcedSpec;

	// Default logic for V2: prefer Ollama Cloud if possible, fallback to Gemini
	if (process.env.OLLAMA_API_KEY) return "ollama-cloud/gpt-oss:120b";
	return "gemini/gemini-2.0-flash";
}

export function createCompactModel(): ModelProvider {
	if (process.env.OLLAMA_API_KEY) {
		return new OllamaCloudProvider(process.env.OLLAMA_API_KEY, "gpt-oss:120b");
	}
	return new GeminiProvider(
		process.env.GEMINI_API_KEY || "",
		"gemini-2.0-flash-lite",
	);
}
