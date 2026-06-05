/**
 * Injection Probe
 *
 * Scans tool results for untrusted instructions or prompt injection patterns.
 */

export const INJECTION_PATTERNS: RegExp[] = [
	/ignore all previous instructions/i,
	/system instructions/i,
	/you are now a/i,
	/new rule:/i,
	/SYSTEM:/,
	/USER:/,
	/ASSISTANT:/,
	/\[UNTRUSTED_CONTENT\]/i,
	/you are an ai/i,
	/pretend you are/i,
	/your new role is/i,
	/override your previous instructions/i,
];

export interface ProbeResult {
	flagged: boolean;
	pattern?: string;
	startIndex?: number;
}

export class InjectionProbe {
	/**
	 * Scans a tool output string for potential injection attempts.
	 */
	static scan(content: string): ProbeResult {
		if (!content || typeof content !== "string") {
			return { flagged: false };
		}

		for (const pattern of INJECTION_PATTERNS) {
			const match = pattern.exec(content);
			if (match) {
				return {
					flagged: true,
					pattern: pattern.toString(),
					startIndex: match.index,
				};
			}
		}

		return { flagged: false };
	}

	/**
	 * Wraps untrusted content in defensive tags for LLM consumption.
	 */
	static wrap(content: string): string {
		return `\n[UNTRUSTED_CONTENT_START]\n${content}\n[UNTRUSTED_CONTENT_END]\n`;
	}

	/**
	 * Removes common injection markers (sanitization)
	 */
	static sanitize(content: string): string {
		let sanitized = content;
		for (const pattern of INJECTION_PATTERNS) {
			sanitized = sanitized.replace(pattern, "[REDACTED_INJECTION_ATTEMPT]");
		}
		return sanitized;
	}
}
