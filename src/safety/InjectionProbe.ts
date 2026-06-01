/**
 * Injection Probe
 * 
 * Scans tool results for untrusted instructions or prompt injection patterns.
 */

export const INJECTION_PATTERNS = [
  /ignore all previous instructions/i,
  /system instructions/i,
  /you are now a/i,
  /new rule:/i,
  /SYSTEM:/,
  /USER:/,
  /ASSISTANT:/,
  /\[UNTRUSTED_CONTENT\]/i,
];

export interface ProbeResult {
  flagged: boolean;
  pattern?: string;
}

export class InjectionProbe {
  /**
   * Scans a tool output string for potential injection attempts.
   */
  static scan(content: string): ProbeResult {
    if (!content) return { flagged: false };

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        return { flagged: true, pattern: pattern.toString() };
      }
    }

    return { flagged: false };
  }

  /**
   * Wraps untrusted content in defensive tags.
   */
  static wrap(content: string): string {
    return `[UNTRUSTED_CONTENT_START]\n${content}\n[UNTRUSTED_CONTENT_END]`;
  }
}
