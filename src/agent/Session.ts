import type { ModelProvider } from "../providers/ModelProvider.js";

export interface SessionConfig {
	sessionId: string;
	projectRoot: string;
	provider: ModelProvider;
	model: string;
	maxTurns: number;
	budget: number;
}
